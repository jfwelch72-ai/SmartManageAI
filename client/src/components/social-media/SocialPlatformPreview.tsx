import { Image } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { CHAR_LIMITS, getPlatformInfo } from "./types";

export function PlatformPreview({ platform, content, hashtags, mediaUrls }: { platform: string; content: string; hashtags: string[]; mediaUrls: string[] }) {
  const info = getPlatformInfo(platform);
  const Icon = info.icon;
  const fullContent = content + (hashtags.length > 0 ? "\n\n" + hashtags.map(h => `#${h}`).join(" ") : "");
  const charLimit = CHAR_LIMITS[platform] || 5000;
  const isOver = fullContent.length > charLimit;

  if (platform === "TWITTER") {
    return (
      <div className="rounded-xl border p-4 max-w-sm bg-background">
        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0"><Icon className="h-5 w-5" /></div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold">Your Company</span>
              <span className="text-xs text-muted-foreground">@company · now</span>
            </div>
            <p className={`text-sm mt-1 whitespace-pre-wrap ${isOver ? "text-destructive" : ""}`}>{fullContent || "Your tweet will appear here..."}</p>
            {mediaUrls.length > 0 && (
              <div className={`mt-2 grid gap-1 ${mediaUrls.length === 1 ? "grid-cols-1" : "grid-cols-2"} rounded-xl overflow-hidden`}>
                {mediaUrls.slice(0, 4).map((url, i) => <img key={i} src={url} alt="" className="w-full h-32 object-cover" />)}
              </div>
            )}
            <div className="flex justify-between mt-3 text-muted-foreground max-w-[250px]">
              {["💬", "🔁", "❤️", "📤"].map((e, i) => <span key={i} className="text-xs">{e}</span>)}
            </div>
          </div>
        </div>
        <p className={`text-xs mt-2 ${isOver ? "text-destructive font-medium" : "text-muted-foreground"}`}>{fullContent.length}/{charLimit}</p>
      </div>
    );
  }

  if (platform === "INSTAGRAM") {
    return (
      <div className="rounded-xl border max-w-sm bg-background overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 p-0.5"><div className="w-full h-full rounded-full bg-background flex items-center justify-center"><Icon className="h-3.5 w-3.5" style={{ color: info.color }} /></div></div>
          <span className="text-xs font-semibold">your_company</span>
        </div>
        <div className="aspect-square bg-muted flex items-center justify-center">
          {mediaUrls.length > 0 ? <img src={mediaUrls[0]} alt="" className="w-full h-full object-cover" /> : <Image className="h-12 w-12 text-muted-foreground/30" />}
        </div>
        <div className="px-3 py-2">
          <div className="flex gap-3 mb-2 text-lg">❤️ 💬 📤</div>
          <p className="text-xs"><strong>your_company</strong> {content || "Caption..."}</p>
          {hashtags.length > 0 && <p className="text-xs text-blue-500 mt-1">{hashtags.map(h => `#${h}`).join(" ")}</p>}
        </div>
      </div>
    );
  }

  if (platform === "LINKEDIN") {
    return (
      <div className="rounded-xl border max-w-md bg-background p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center"><Icon className="h-6 w-6" style={{ color: info.color }} /></div>
          <div>
            <p className="text-sm font-semibold">Your Company</p>
            <p className="text-xs text-muted-foreground">Construction · Just now</p>
          </div>
        </div>
        <p className="text-sm whitespace-pre-wrap">{fullContent || "Your post will appear here..."}</p>
        {mediaUrls.length > 0 && (
          <div className="mt-3 rounded-lg overflow-hidden border">
            <img src={mediaUrls[0]} alt="" className="w-full h-48 object-cover" />
          </div>
        )}
        <Separator className="my-3" />
        <div className="flex justify-around text-xs text-muted-foreground">
          {["👍 Like", "💬 Comment", "🔁 Repost", "📤 Send"].map(a => <span key={a}>{a}</span>)}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border max-w-md bg-background p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center"><Icon className="h-5 w-5" style={{ color: info.color }} /></div>
        <div>
          <p className="text-sm font-semibold">Your Company</p>
          <p className="text-xs text-muted-foreground">Just now · 🌐</p>
        </div>
      </div>
      <p className="text-sm whitespace-pre-wrap">{fullContent || "Your post will appear here..."}</p>
      {mediaUrls.length > 0 && (
        <div className={`mt-3 grid gap-1 ${mediaUrls.length === 1 ? "grid-cols-1" : "grid-cols-2"} rounded-lg overflow-hidden`}>
          {mediaUrls.slice(0, 4).map((url, i) => <img key={i} src={url} alt="" className="w-full h-40 object-cover" />)}
        </div>
      )}
      <Separator className="my-3" />
      <div className="flex justify-around text-xs text-muted-foreground">
        {["👍 Like", "💬 Comment", "↗ Share"].map(a => <span key={a}>{a}</span>)}
      </div>
      {isOver && <p className="text-xs text-destructive mt-2">{fullContent.length}/{charLimit} characters</p>}
    </div>
  );
}
