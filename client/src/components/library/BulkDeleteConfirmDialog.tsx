import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface BulkDeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onConfirm: () => void;
  isPending: boolean;
  /** Distinguishes the two consumers' button test-ids. */
  testIdPrefix?: string;
}

export function BulkDeleteConfirmDialog({
  open,
  onOpenChange,
  selectedCount,
  onConfirm,
  isPending,
  testIdPrefix = "",
}: BulkDeleteConfirmDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!isPending) onOpenChange(o);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {selectedCount} {selectedCount === 1 ? "item" : "items"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the {selectedCount} selected library{" "}
            {selectedCount === 1 ? "item" : "items"}. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={isPending}
            data-testid={`btn-cancel-${testIdPrefix}bulk-delete`}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={isPending || selectedCount === 0}
            data-testid={`btn-confirm-${testIdPrefix}bulk-delete`}
          >
            {isPending ? "Deleting…" : `Delete ${selectedCount}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
