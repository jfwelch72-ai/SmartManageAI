import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface DailyNote {
  id: string;
  author: string;
  authorRole: string;
  date: string;
  time: string;
  content: string;
}

interface DailyNoteFeedProps {
  notes: DailyNote[];
  onAddNote?: (content: string) => void;
}

export default function DailyNoteFeed({ notes, onAddNote }: DailyNoteFeedProps) {
  const [newNote, setNewNote] = useState("");

  const handleSubmit = () => {
    if (newNote.trim() && onAddNote) {
      onAddNote(newNote);
      setNewNote("");
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add Daily Note</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="Document today's progress, issues, or important updates..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            className="min-h-24"
            data-testid="textarea-daily-note"
          />
          <Button onClick={handleSubmit} data-testid="button-add-daily-note">
            Add Note
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daily Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {notes.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No notes yet. Add the first daily note above.
              </p>
            ) : (
              notes.map((note) => {
                const initials = note.author
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase();

                return (
                  <div
                    key={note.id}
                    className="flex gap-4 p-4 border rounded-md"
                    data-testid={`note-${note.id}`}
                  >
                    <Avatar className="w-10 h-10 shrink-0">
                      <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <p className="font-medium text-sm">{note.author}</p>
                          <p className="text-xs text-muted-foreground">{note.authorRole}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-muted-foreground">{note.date}</p>
                          <p className="text-xs text-muted-foreground">{note.time}</p>
                        </div>
                      </div>
                      <p className="text-sm text-card-foreground whitespace-pre-wrap">
                        {note.content}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
