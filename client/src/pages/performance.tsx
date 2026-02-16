import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Star, Award, Trophy, TrendingUp, Users, Plus, Send, Crown, Medal, Target, BarChart3, Gift, ChevronDown, ChevronUp, Trash2, Pencil, Check, X, Loader2 } from "lucide-react";

interface Criteria { id: string; name: string; description: string; weight: string; maxScore: number; isActive: boolean; sortOrder: number; }
interface EligibleEmployee { id: string; firstName: string; lastName: string; role: string; }
interface RatingScore { criteriaId: string; score: string; comment?: string; criteriaName: string; }
interface Rating { id: string; employeeId: string; evaluatorId: string; projectId?: string; period?: string; overallScore: string; weightedScore: string; comments?: string; createdAt: string; scores: RatingScore[]; employeeName: string; evaluatorName: string; }
interface RewardType { id: string; name: string; description: string; category: string; value: string; isActive: boolean; }
interface Reward { id: string; employeeId: string; rewardTypeId: string; assignedById: string; ratingId?: string; amount?: string; justification?: string; expiresAt?: string; createdAt: string; rewardTypeName: string; employeeName: string; assignedByName: string; }
interface LeaderboardEntry { employeeId: string; firstName: string; lastName: string; role: string; avgScore: string; ratingCount: number; }
interface RewardAnalytics { totalRewards: number; totalAmount: string; byType: { category: string; count: number; totalAmount: string }[]; byMonth: { month: string; count: number; totalAmount: string }[]; }

const criteriaSchema = z.object({ name: z.string().min(1), description: z.string().optional(), weight: z.coerce.number().min(0).max(100), maxScore: z.coerce.number().min(1).max(100) });
const rewardTypeSchema = z.object({ name: z.string().min(1), description: z.string().optional(), category: z.string().min(1), value: z.coerce.number().min(0) });
const assignRewardSchema = z.object({ employeeId: z.string().min(1), rewardTypeId: z.string().min(1), amount: z.coerce.number().optional(), justification: z.string().optional(), ratingId: z.string().optional() });

function ManageCriteriaDialog() {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editWeight, setEditWeight] = useState("");
  const [editMaxScore, setEditMaxScore] = useState("");
  const { data: criteria = [], isLoading } = useQuery<Criteria[]>({ queryKey: ["/api/performance/criteria"] });
  const form = useForm<z.infer<typeof criteriaSchema>>({ resolver: zodResolver(criteriaSchema), defaultValues: { name: "", description: "", weight: 1, maxScore: 10 } });

  const createMut = useMutation({
    mutationFn: async (data: z.infer<typeof criteriaSchema>) => { const res = await apiRequest("POST", "/api/performance/criteria", data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/performance/criteria"] }); form.reset(); toast({ title: "Criteria created" }); },
    onError: (e: Error) => { toast({ title: "Failed to create criteria", description: e.message, variant: "destructive" }); },
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Criteria> }) => { const res = await apiRequest("PATCH", `/api/performance/criteria/${id}`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/performance/criteria"] }); setEditingId(null); toast({ title: "Criteria updated" }); },
    onError: (e: Error) => { toast({ title: "Update failed", description: e.message, variant: "destructive" }); },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => { const res = await apiRequest("DELETE", `/api/performance/criteria/${id}`); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/performance/criteria"] }); toast({ title: "Criteria deactivated" }); },
    onError: (e: Error) => { toast({ title: "Delete failed", description: e.message, variant: "destructive" }); },
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-manage-criteria"><Target className="w-4 h-4 mr-2" />Manage Criteria</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Rating Criteria</DialogTitle></DialogHeader>
        {isLoading ? <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Weight</TableHead><TableHead>Max</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {criteria.map((c) => (
                <TableRow key={c.id} data-testid={`criteria-row-${c.id}`}>
                  {editingId === c.id ? (<>
                    <TableCell><Input value={editName} onChange={(e) => setEditName(e.target.value)} data-testid={`input-edit-criteria-name-${c.id}`} /></TableCell>
                    <TableCell><Input type="number" value={editWeight} onChange={(e) => setEditWeight(e.target.value)} data-testid={`input-edit-criteria-weight-${c.id}`} /></TableCell>
                    <TableCell><Input type="number" value={editMaxScore} onChange={(e) => setEditMaxScore(e.target.value)} data-testid={`input-edit-criteria-max-${c.id}`} /></TableCell>
                    <TableCell><Badge variant={c.isActive ? "default" : "secondary"}>{c.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell><div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" onClick={() => updateMut.mutate({ id: c.id, data: { name: editName, weight: Number(editWeight), maxScore: Number(editMaxScore) } })} disabled={updateMut.isPending} data-testid={`button-save-criteria-${c.id}`}><Check className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => setEditingId(null)} data-testid={`button-cancel-criteria-${c.id}`}><X className="w-4 h-4" /></Button>
                    </div></TableCell>
                  </>) : (<>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.weight}</TableCell>
                    <TableCell>{c.maxScore}</TableCell>
                    <TableCell><Badge variant={c.isActive ? "default" : "secondary"}>{c.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell><div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditingId(c.id); setEditName(c.name); setEditWeight(String(c.weight)); setEditMaxScore(String(c.maxScore)); }} data-testid={`button-edit-criteria-${c.id}`}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => deleteMut.mutate(c.id)} disabled={deleteMut.isPending} data-testid={`button-delete-criteria-${c.id}`}><Trash2 className="w-4 h-4" /></Button>
                    </div></TableCell>
                  </>)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="border-t pt-4 mt-4">
          <p className="text-sm font-medium mb-3">Add New Criteria</p>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((d) => createMut.mutate(d))} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} placeholder="e.g. Quality of Work" data-testid="input-new-criteria-name" /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="description" render={({ field }) => (<FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} placeholder="Optional" data-testid="input-new-criteria-desc" /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="weight" render={({ field }) => (<FormItem><FormLabel>Weight</FormLabel><FormControl><Input type="number" {...field} data-testid="input-new-criteria-weight" /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="maxScore" render={({ field }) => (<FormItem><FormLabel>Max Score</FormLabel><FormControl><Input type="number" {...field} data-testid="input-new-criteria-max" /></FormControl><FormMessage /></FormItem>)} />
              <div className="sm:col-span-2">
                <Button type="submit" disabled={createMut.isPending} data-testid="button-add-criteria">
                  {createMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}Add Criteria
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RatingTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [period, setPeriod] = useState("");
  const [ratingComment, setRatingComment] = useState("");
  const [historyView, setHistoryView] = useState<"received" | "given">("received");
  const [expandedRating, setExpandedRating] = useState<string | null>(null);

  const { data: criteria = [] } = useQuery<Criteria[]>({ queryKey: ["/api/performance/criteria"] });
  const { data: employees = [], isLoading: loadingEmp } = useQuery<EligibleEmployee[]>({ queryKey: ["/api/performance/eligible-employees"] });
  const { data: myRatings = [], isLoading: loadingMy } = useQuery<Rating[]>({ queryKey: ["/api/performance/ratings/my"] });
  const { data: givenRatings = [], isLoading: loadingGiven } = useQuery<Rating[]>({
    queryKey: ["/api/performance/ratings", { evaluatorId: user?.id }],
    queryFn: () => fetch(`/api/performance/ratings?evaluatorId=${user?.id}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!user?.id,
  });

  const activeCriteria = criteria.filter((c) => c.isActive);

  const submitMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/performance/ratings", {
        employeeId: selectedEmployee, period: period || undefined, comments: ratingComment || undefined,
        scores: activeCriteria.map((c) => ({ criteriaId: c.id, score: scores[c.id] || 0 })),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/performance/ratings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/performance/ratings/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/performance/leaderboard"] });
      setSelectedEmployee(""); setScores({}); setPeriod(""); setRatingComment("");
      toast({ title: "Rating submitted successfully" });
    },
    onError: (e: Error) => { toast({ title: "Failed to submit rating", description: e.message, variant: "destructive" }); },
  });

  const displayed = historyView === "received" ? myRatings : givenRatings;
  const loadingHist = historyView === "received" ? loadingMy : loadingGiven;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Star className="w-5 h-5" />Rate an Employee</CardTitle>
          <CardDescription>Select an employee and provide your rating</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingEmp ? <Skeleton className="h-10 w-full" /> : (
            <div>
              <label className="text-sm font-medium mb-1.5 block">Employee</label>
              <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                <SelectTrigger data-testid="select-employee-to-rate"><SelectValue placeholder="Select an employee..." /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (<SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName} - {e.role}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          )}
          {selectedEmployee && activeCriteria.length > 0 && (<>
            <div className="space-y-4">
              {activeCriteria.map((c) => (
                <div key={c.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <label className="text-sm font-medium">{c.name}</label>
                    <Badge variant="outline" className="text-xs">Max: {c.maxScore}</Badge>
                  </div>
                  {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
                  <Input type="number" min={0} max={c.maxScore} value={scores[c.id] ?? ""} onChange={(e) => setScores((p) => ({ ...p, [c.id]: Number(e.target.value) }))} placeholder={`0 - ${c.maxScore}`} data-testid={`input-score-${c.id}`} />
                </div>
              ))}
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Period</label>
              <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. Q1 2026" data-testid="input-rating-period" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Overall Comments</label>
              <Textarea value={ratingComment} onChange={(e) => setRatingComment(e.target.value)} placeholder="Provide overall feedback..." rows={3} data-testid="textarea-rating-comments" />
            </div>
            <Button onClick={() => submitMut.mutate()} disabled={submitMut.isPending || !selectedEmployee} className="w-full" data-testid="button-submit-rating">
              {submitMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}Submit Rating
            </Button>
          </>)}
          {selectedEmployee && activeCriteria.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No active rating criteria configured. Ask an admin to set up criteria.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2"><Award className="w-5 h-5" />Rating History</CardTitle>
            <div className="flex gap-1">
              <Button variant={historyView === "received" ? "default" : "outline"} size="sm" onClick={() => setHistoryView("received")} data-testid="button-my-ratings">My Ratings</Button>
              <Button variant={historyView === "given" ? "default" : "outline"} size="sm" onClick={() => setHistoryView("given")} data-testid="button-given-ratings">Given</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingHist ? <div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div> : displayed.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No ratings found</p>
          ) : (
            <div className="space-y-3">
              {displayed.map((r) => (
                <div key={r.id} className="border rounded-md p-3 hover-elevate cursor-pointer" onClick={() => setExpandedRating(expandedRating === r.id ? null : r.id)} data-testid={`rating-card-${r.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8"><AvatarFallback className="text-xs">{(historyView === "received" ? r.evaluatorName : r.employeeName)?.[0]}</AvatarFallback></Avatar>
                      <div>
                        <p className="text-sm font-medium">{historyView === "received" ? r.evaluatorName : r.employeeName}</p>
                        <p className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}{r.period && ` - ${r.period}`}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{parseFloat(String(r.overallScore)).toFixed(1)}</Badge>
                      {expandedRating === r.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </div>
                  <div className="mt-2">
                    <Progress value={(parseFloat(String(r.overallScore)) / 10) * 100} className="h-2" />
                    <span className="text-xs text-muted-foreground mt-1 block">Weighted: {parseFloat(String(r.weightedScore)).toFixed(2)}</span>
                  </div>
                  {expandedRating === r.id && (
                    <div className="mt-3 pt-3 border-t space-y-2">
                      {r.scores?.map((s, i) => (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <span className="text-sm">{s.criteriaName}</span>
                          <div className="flex items-center gap-2">
                            <Progress value={(parseFloat(String(s.score)) / 10) * 100} className="h-1.5 w-20" />
                            <span className="text-sm font-medium w-8 text-right">{s.score}</span>
                          </div>
                        </div>
                      ))}
                      {r.comments && <p className="text-sm text-muted-foreground mt-2 italic">{r.comments}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RewardsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "ADMIN";
  const [editTypeId, setEditTypeId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCat, setEditCat] = useState("");
  const [editVal, setEditVal] = useState("");

  const { data: myRewards = [], isLoading: loadingMy } = useQuery<Reward[]>({ queryKey: ["/api/performance/rewards/my"] });
  const { data: rewardTypes = [], isLoading: loadingTypes } = useQuery<RewardType[]>({ queryKey: ["/api/performance/reward-types"], enabled: isAdmin });
  const { data: employees = [] } = useQuery<EligibleEmployee[]>({ queryKey: ["/api/performance/eligible-employees"], enabled: isAdmin });
  const { data: allRewards = [], isLoading: loadingAll } = useQuery<Reward[]>({
    queryKey: ["/api/performance/rewards", { all: true }],
    queryFn: () => fetch("/api/performance/rewards?all=true", { credentials: "include" }).then((r) => r.json()),
    enabled: isAdmin,
  });

  const typeForm = useForm<z.infer<typeof rewardTypeSchema>>({ resolver: zodResolver(rewardTypeSchema), defaultValues: { name: "", description: "", category: "", value: 0 } });
  const rewardForm = useForm<z.infer<typeof assignRewardSchema>>({ resolver: zodResolver(assignRewardSchema), defaultValues: { employeeId: "", rewardTypeId: "", amount: 0, justification: "" } });

  const createTypeMut = useMutation({
    mutationFn: async (d: z.infer<typeof rewardTypeSchema>) => { const r = await apiRequest("POST", "/api/performance/reward-types", d); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/performance/reward-types"] }); typeForm.reset(); toast({ title: "Reward type created" }); },
    onError: (e: Error) => { toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  const updateTypeMut = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<RewardType> }) => { const r = await apiRequest("PATCH", `/api/performance/reward-types/${id}`, data); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/performance/reward-types"] }); setEditTypeId(null); toast({ title: "Updated" }); },
    onError: (e: Error) => { toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  const deleteTypeMut = useMutation({
    mutationFn: async (id: string) => { const r = await apiRequest("DELETE", `/api/performance/reward-types/${id}`); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/performance/reward-types"] }); toast({ title: "Deactivated" }); },
    onError: (e: Error) => { toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  const assignMut = useMutation({
    mutationFn: async (d: z.infer<typeof assignRewardSchema>) => { const r = await apiRequest("POST", "/api/performance/rewards", d); return r.json(); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/performance/rewards"] });
      queryClient.invalidateQueries({ queryKey: ["/api/performance/rewards/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/performance/rewards/analytics"] });
      rewardForm.reset(); toast({ title: "Reward assigned" });
    },
    onError: (e: Error) => { toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gift className="w-5 h-5" />My Rewards</CardTitle>
          <CardDescription>Rewards you have received</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingMy ? <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : myRewards.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No rewards received yet</p>
          ) : (
            <div className="space-y-3">
              {myRewards.map((rw) => (
                <div key={rw.id} className="border rounded-md p-3 hover-elevate" data-testid={`reward-card-${rw.id}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2"><Trophy className="w-4 h-4 text-yellow-500" /><span className="font-medium text-sm">{rw.rewardTypeName}</span></div>
                    {rw.amount != null && <Badge variant="default">${rw.amount}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Assigned by {rw.assignedByName} on {new Date(rw.createdAt).toLocaleDateString()}</p>
                  {rw.justification && <p className="text-sm text-muted-foreground mt-1">{rw.justification}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Medal className="w-5 h-5" />Reward Types</CardTitle></CardHeader>
          <CardContent>
            {loadingTypes ? <Skeleton className="h-10 w-full" /> : (
              <div className="space-y-2 mb-4">
                {rewardTypes.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 border rounded-md p-2" data-testid={`reward-type-${t.id}`}>
                    {editTypeId === t.id ? (
                      <div className="flex items-center gap-2 flex-1 flex-wrap">
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1 min-w-[100px]" data-testid={`input-edit-type-name-${t.id}`} />
                        <Input value={editCat} onChange={(e) => setEditCat(e.target.value)} className="w-24" data-testid={`input-edit-type-cat-${t.id}`} />
                        <Input type="number" value={editVal} onChange={(e) => setEditVal(e.target.value)} className="w-20" data-testid={`input-edit-type-val-${t.id}`} />
                        <Button size="icon" variant="ghost" onClick={() => updateTypeMut.mutate({ id: t.id, data: { name: editName, category: editCat, value: Number(editVal) } })} data-testid={`button-save-type-${t.id}`}><Check className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => setEditTypeId(null)} data-testid={`button-cancel-type-${t.id}`}><X className="w-4 h-4" /></Button>
                      </div>
                    ) : (<>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{t.name}</p>
                        <p className="text-xs text-muted-foreground">{t.category} - ${t.value}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge variant={t.isActive ? "default" : "secondary"} className="shrink-0">{t.isActive ? "Active" : "Inactive"}</Badge>
                        <Button size="icon" variant="ghost" onClick={() => { setEditTypeId(t.id); setEditName(t.name); setEditCat(t.category); setEditVal(String(t.value)); }} data-testid={`button-edit-type-${t.id}`}><Pencil className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => deleteTypeMut.mutate(t.id)} data-testid={`button-delete-type-${t.id}`}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </>)}
                  </div>
                ))}
              </div>
            )}
            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-3">Add Reward Type</p>
              <Form {...typeForm}>
                <form onSubmit={typeForm.handleSubmit((d) => createTypeMut.mutate(d))} className="space-y-3">
                  <FormField control={typeForm.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} placeholder="e.g. Employee of the Month" data-testid="input-new-type-name" /></FormControl><FormMessage /></FormItem>)} />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={typeForm.control} name="category" render={({ field }) => (<FormItem><FormLabel>Category</FormLabel><FormControl><Input {...field} placeholder="e.g. Bonus" data-testid="input-new-type-cat" /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={typeForm.control} name="value" render={({ field }) => (<FormItem><FormLabel>Value</FormLabel><FormControl><Input type="number" {...field} data-testid="input-new-type-val" /></FormControl><FormMessage /></FormItem>)} />
                  </div>
                  <FormField control={typeForm.control} name="description" render={({ field }) => (<FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} placeholder="Optional" data-testid="input-new-type-desc" /></FormControl><FormMessage /></FormItem>)} />
                  <Button type="submit" disabled={createTypeMut.isPending} data-testid="button-add-type">
                    {createTypeMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}Add Type
                  </Button>
                </form>
              </Form>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Gift className="w-5 h-5" />Assign Reward</CardTitle>
            <CardDescription>Recognize outstanding employee performance</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...rewardForm}>
              <form onSubmit={rewardForm.handleSubmit((d) => assignMut.mutate(d))} className="space-y-4">
                <FormField control={rewardForm.control} name="employeeId" render={({ field }) => (
                  <FormItem><FormLabel>Employee</FormLabel>
                    <Select value={field.value || ""} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger data-testid="select-reward-employee"><SelectValue placeholder="Select employee..." /></SelectTrigger></FormControl>
                      <SelectContent>{employees.map((e) => (<SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>))}</SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
                <FormField control={rewardForm.control} name="rewardTypeId" render={({ field }) => (
                  <FormItem><FormLabel>Reward Type</FormLabel>
                    <Select value={field.value || ""} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger data-testid="select-reward-type"><SelectValue placeholder="Select reward type..." /></SelectTrigger></FormControl>
                      <SelectContent>{rewardTypes.filter((t) => t.isActive).map((t) => (<SelectItem key={t.id} value={t.id}>{t.name} (${t.value})</SelectItem>))}</SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
                <FormField control={rewardForm.control} name="amount" render={({ field }) => (<FormItem><FormLabel>Amount (optional)</FormLabel><FormControl><Input type="number" {...field} placeholder="Leave blank for default" data-testid="input-reward-amount" /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={rewardForm.control} name="justification" render={({ field }) => (<FormItem><FormLabel>Justification</FormLabel><FormControl><Textarea {...field} placeholder="Why is this employee being rewarded?" rows={3} data-testid="textarea-reward-justification" /></FormControl><FormMessage /></FormItem>)} />
                <Button type="submit" disabled={assignMut.isPending} className="w-full" data-testid="button-assign-reward">
                  {assignMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Award className="w-4 h-4 mr-2" />}Assign Reward
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Trophy className="w-5 h-5" />Recent Rewards</CardTitle></CardHeader>
        <CardContent>
          {loadingAll ? <Skeleton className="h-12 w-full" /> : allRewards.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No rewards assigned yet</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Reward</TableHead><TableHead>Amount</TableHead><TableHead>Assigned By</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
              <TableBody>
                {allRewards.slice(0, 20).map((rw) => (
                  <TableRow key={rw.id} data-testid={`recent-reward-${rw.id}`}>
                    <TableCell className="font-medium">{rw.employeeName}</TableCell>
                    <TableCell>{rw.rewardTypeName}</TableCell>
                    <TableCell>{rw.amount != null ? `$${rw.amount}` : "-"}</TableCell>
                    <TableCell>{rw.assignedByName}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(rw.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AnalyticsTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const { data: leaderboard = [], isLoading: loadingLb } = useQuery<LeaderboardEntry[]>({ queryKey: ["/api/performance/leaderboard"] });
  const { data: analytics, isLoading: loadingAn } = useQuery<RewardAnalytics>({ queryKey: ["/api/performance/rewards/analytics"], enabled: isAdmin });

  const totalRatings = leaderboard.reduce((s, e) => s + e.ratingCount, 0);
  const avgScore = leaderboard.length > 0 ? leaderboard.reduce((s, e) => s + parseFloat(String(e.avgScore)), 0) / leaderboard.length : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="hover-elevate" data-testid="stat-total-ratings"><CardContent className="pt-6"><div className="flex items-center justify-between gap-2"><div><p className="text-2xl font-bold">{totalRatings}</p><p className="text-sm text-muted-foreground">Total Ratings</p></div><Star className="w-8 h-8 text-muted-foreground/50" /></div></CardContent></Card>
        <Card className="hover-elevate" data-testid="stat-avg-score"><CardContent className="pt-6"><div className="flex items-center justify-between gap-2"><div><p className="text-2xl font-bold">{avgScore.toFixed(1)}</p><p className="text-sm text-muted-foreground">Avg Score</p></div><TrendingUp className="w-8 h-8 text-muted-foreground/50" /></div></CardContent></Card>
        {isAdmin && analytics && (<>
          <Card className="hover-elevate" data-testid="stat-total-rewards"><CardContent className="pt-6"><div className="flex items-center justify-between gap-2"><div><p className="text-2xl font-bold">{analytics.totalRewards}</p><p className="text-sm text-muted-foreground">Total Rewards</p></div><Trophy className="w-8 h-8 text-muted-foreground/50" /></div></CardContent></Card>
          <Card className="hover-elevate" data-testid="stat-total-amount"><CardContent className="pt-6"><div className="flex items-center justify-between gap-2"><div><p className="text-2xl font-bold">${parseFloat(String(analytics.totalAmount || 0)).toLocaleString()}</p><p className="text-sm text-muted-foreground">Total Amount</p></div><Gift className="w-8 h-8 text-muted-foreground/50" /></div></CardContent></Card>
        </>)}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Crown className="w-5 h-5" />Leaderboard</CardTitle>
          <CardDescription>Top performing employees</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingLb ? <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : leaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No performance data available yet</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead className="w-12">Rank</TableHead><TableHead>Employee</TableHead><TableHead>Role</TableHead><TableHead>Avg Score</TableHead><TableHead>Ratings</TableHead></TableRow></TableHeader>
              <TableBody>
                {leaderboard.map((e, i) => (
                  <TableRow key={e.employeeId} data-testid={`leaderboard-row-${e.employeeId}`}>
                    <TableCell>
                      {i === 0 && <Crown className="w-4 h-4 text-yellow-500" />}
                      {i === 1 && <Medal className="w-4 h-4 text-gray-400" />}
                      {i === 2 && <Medal className="w-4 h-4 text-amber-600" />}
                      {i > 2 && <span className="text-sm text-muted-foreground pl-1">{i + 1}</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7"><AvatarFallback className="text-xs">{e.firstName[0]}{e.lastName[0]}</AvatarFallback></Avatar>
                        <span className="font-medium text-sm">{e.firstName} {e.lastName}</span>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{e.role}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={(parseFloat(String(e.avgScore)) / 10) * 100} className="h-1.5 w-16" />
                        <span className="text-sm font-medium">{parseFloat(String(e.avgScore)).toFixed(1)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{e.ratingCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {isAdmin && analytics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="w-5 h-5" />Rewards by Category</CardTitle></CardHeader>
            <CardContent>
              {analytics.byType.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">No data available</p> : (
                <div className="space-y-3">
                  {analytics.byType.map((item) => (
                    <div key={item.category} className="space-y-1" data-testid={`analytics-category-${item.category}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{item.category}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">{item.count} rewards</span>
                          <span className="text-sm font-medium">${parseFloat(String(item.totalAmount)).toLocaleString()}</span>
                        </div>
                      </div>
                      <Progress value={parseFloat(String(analytics.totalAmount)) > 0 ? (parseFloat(String(item.totalAmount)) / parseFloat(String(analytics.totalAmount))) * 100 : 0} className="h-2" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="w-5 h-5" />Rewards by Month</CardTitle></CardHeader>
            <CardContent>
              {analytics.byMonth.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">No data available</p> : (
                <div className="space-y-3">
                  {analytics.byMonth.map((item) => (
                    <div key={item.month} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0" data-testid={`analytics-month-${item.month}`}>
                      <span className="text-sm">{item.month}</span>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="text-xs">{item.count} rewards</Badge>
                        <span className="text-sm font-medium">${parseFloat(String(item.totalAmount)).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function PerformancePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const isManager = user?.role === "MANAGER" || user?.role === "OFFICE_MANAGER";
  const canViewAnalytics = isAdmin || isManager;

  if (!user) return <div className="p-6 space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-6 md:py-8">
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title"><Trophy className="w-6 h-6" />Performance & Rewards</h1>
            <p className="text-muted-foreground mt-1">Track employee ratings, recognize achievements, and analyze team performance</p>
          </div>
          {isAdmin && <ManageCriteriaDialog />}
        </div>
        <Tabs defaultValue="ratings" className="space-y-6">
          <TabsList data-testid="performance-tabs">
            <TabsTrigger value="ratings" data-testid="tab-ratings"><Star className="w-4 h-4 mr-1.5" />Ratings</TabsTrigger>
            <TabsTrigger value="rewards" data-testid="tab-rewards"><Gift className="w-4 h-4 mr-1.5" />Rewards</TabsTrigger>
            {canViewAnalytics && <TabsTrigger value="analytics" data-testid="tab-analytics"><BarChart3 className="w-4 h-4 mr-1.5" />Analytics</TabsTrigger>}
          </TabsList>
          <TabsContent value="ratings"><RatingTab /></TabsContent>
          <TabsContent value="rewards"><RewardsTab /></TabsContent>
          {canViewAnalytics && <TabsContent value="analytics"><AnalyticsTab /></TabsContent>}
        </Tabs>
      </div>
    </div>
  );
}
