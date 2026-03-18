interface VoicePlayerProps {
  url: string;
  durationSeconds: number | null;
}

export function VoicePlayer({ url, durationSeconds }: VoicePlayerProps) {
  const label = durationSeconds
    ? `Voice message (${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, "0")})`
    : "Voice message";
  return (
    <div className="mt-1">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <audio controls src={url} className="max-w-xs h-8" data-testid="audio-voice-message" />
    </div>
  );
}
