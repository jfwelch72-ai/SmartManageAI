import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { isVendor } from "@/lib/rbac";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import {
  ShoppingCart,
  Package,
  Building2,
  Calendar,
  DollarSign,
  CheckCircle2,
  Clock,
  Truck,
} from "lucide-react";

interface PurchaseOrder {
  id: string;
  poNumber: string;
  contractorOrgName: string;
  projectName: string;
  status: "pending" | "approved" | "shipped" | "delivered" | "cancelled";
  totalAmount: number;
  items: number;
  createdAt: string;
  expectedDelivery: string | null;
}

export default function VendorPurchaseOrdersPage() {
  const { user } = useAuth();

  if (!isVendor(user?.role)) {
    return <Redirect to="/dashboard" />;
  }

  const { data: orders, isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/vendor/purchase-orders"],
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid={`badge-status-${status}`}><CheckCircle2 className="w-3 h-3 mr-1" />Approved</Badge>;
      case "shipped":
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" data-testid={`badge-status-${status}`}><Truck className="w-3 h-3 mr-1" />Shipped</Badge>;
      case "delivered":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid={`badge-status-${status}`}><Package className="w-3 h-3 mr-1" />Delivered</Badge>;
      case "cancelled":
        return <Badge variant="destructive" data-testid={`badge-status-${status}`}>Cancelled</Badge>;
      default:
        return <Badge variant="outline" data-testid={`badge-status-${status}`}><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Purchase Orders</h1>
        <p className="text-muted-foreground mt-1">View and track purchase orders from contractors for your materials and services.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-stat-active">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                <ShoppingCart className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Orders</p>
                <p className="text-2xl font-bold" data-testid="text-active-count">
                  {orders?.filter(o => ["pending", "approved", "shipped"].includes(o.status)).length ?? 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-total">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900">
                <DollarSign className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Value</p>
                <p className="text-2xl font-bold" data-testid="text-total-value">
                  {formatCurrency(orders?.reduce((sum, o) => sum + o.totalAmount, 0) ?? 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-delivered">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900">
                <CheckCircle2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Delivered</p>
                <p className="text-2xl font-bold" data-testid="text-delivered-count">
                  {orders?.filter(o => o.status === "delivered").length ?? 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle data-testid="text-orders-title">All Purchase Orders</CardTitle>
          <CardDescription>Purchase orders issued to you by contractor organizations</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : orders && orders.length > 0 ? (
            <div className="space-y-3">
              {orders.map((order) => (
                <div key={order.id} className="flex items-center justify-between p-4 border rounded-lg" data-testid={`row-order-${order.id}`}>
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded bg-muted">
                      <ShoppingCart className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium" data-testid={`text-po-number-${order.id}`}>PO #{order.poNumber}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Building2 className="w-3 h-3" />
                        <span>{order.contractorOrgName}</span>
                        <span>&middot;</span>
                        <span>{order.projectName}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-0.5">
                        <Calendar className="w-3 h-3" />
                        <span>{new Date(order.createdAt).toLocaleDateString()}</span>
                        <span>&middot;</span>
                        <span>{order.items} item{order.items !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-semibold" data-testid={`text-po-amount-${order.id}`}>{formatCurrency(order.totalAmount)}</span>
                    {getStatusBadge(order.status)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <ShoppingCart className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground" data-testid="text-no-orders">No purchase orders yet</p>
              <p className="text-sm text-muted-foreground mt-1">Purchase orders from contractors will appear here when they order your materials or services.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
