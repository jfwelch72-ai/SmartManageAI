import { useState, useCallback, useRef, useEffect } from "react";
import type { ReactNode, DragEvent } from "react";
import Uppy from "@uppy/core";
import DashboardModal from "@uppy/react/dashboard-modal";
import AwsS3 from "@uppy/aws-s3";
import type { UploadResult } from "@uppy/core";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export const MULTIPART_THRESHOLD = 10 * 1024 * 1024;

interface UploadParams {
  method: "PUT";
  url: string;
  intentId?: string;
  objectKey?: string;
}

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  allowedFileTypes?: string[];
  fileType?: "MEDIA" | "DOCUMENT" | "RECEIPT" | "BIM" | "LIDAR";
  onGetUploadParameters?: (file: { name: string; type: string; size: number }) => Promise<UploadParams>;
  onComplete?: (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>
  ) => void;
  buttonVariant?: "default" | "outline" | "ghost" | "secondary";
  buttonClassName?: string;
  children: ReactNode;
  testId?: string;
}

async function confirmIntent(intentId: string): Promise<string> {
  const res = await apiRequest("POST", "/api/objects/confirm", { intentId });
  const data = (await res.json()) as { objectPath: string; intentId: string };
  return data.objectPath;
}

async function confirmIntents(intentIds: string[]): Promise<string[]> {
  return Promise.all(intentIds.map((id) => confirmIntent(id)));
}

async function getDefaultUploadParameters(
  file: { name: string; type: string; size: number },
  fileType?: string
): Promise<UploadParams> {
  const contentType = file.type || "application/octet-stream";
  const fileSize = file.size || 0;

  const res = await apiRequest("POST", "/api/objects/upload", {
    contentType,
    fileSize,
    fileType: fileType ?? "DOCUMENT",
  });
  const data = (await res.json()) as { uploadURL: string; intentId: string; objectKey: string };
  return {
    method: "PUT" as const,
    url: data.uploadURL,
    intentId: data.intentId,
    objectKey: data.objectKey,
  };
}

export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 104857600,
  allowedFileTypes,
  fileType,
  onGetUploadParameters,
  onComplete,
  children,
  testId,
}: ObjectUploaderProps) {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const intentMapRef = useRef<Map<string, string>>(new Map());
  const onCompleteRef = useRef(onComplete);
  const toastRef = useRef(toast);
  const resolvedFileType = fileType ?? "DOCUMENT";

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const [uppy] = useState(() => {
    const instance = new Uppy({
      restrictions: {
        maxNumberOfFiles,
        maxFileSize,
        allowedFileTypes,
      },
      autoProceed: false,
    });

    instance.use(AwsS3, {
      shouldUseMultipart: (file) => !onGetUploadParameters && (file.size ?? 0) > MULTIPART_THRESHOLD,

      getUploadParameters: async (file) => {
        const fileInfo = {
          name: file.name ?? "",
          type: file.type ?? "application/octet-stream",
          size: file.size ?? 0,
        };

        let params: UploadParams;
        if (onGetUploadParameters) {
          params = await onGetUploadParameters(fileInfo);
        } else {
          params = await getDefaultUploadParameters(fileInfo, resolvedFileType);
        }

        if (params.intentId && file.id) {
          intentMapRef.current.set(file.id, params.intentId);
        }

        return params;
      },

      createMultipartUpload: async (file) => {
        const res = await apiRequest("POST", "/api/objects/multipart", {
          contentType: file.type ?? "application/octet-stream",
          fileSize: file.size ?? 0,
          fileType: resolvedFileType,
        });
        const data = (await res.json()) as { uploadId: string; key: string };
        return { uploadId: data.uploadId, key: data.key };
      },

      listParts: async (_file, { uploadId }) => {
        const res = await apiRequest("GET", `/api/objects/multipart/${uploadId}`, undefined);
        const data = (await res.json()) as { parts: Array<{ PartNumber: number; ETag: string; Size: number }> };
        return data.parts;
      },

      signPart: async (_file, { uploadId, partNumber, body }) => {
        const qs = body ? `?chunkSize=${body.size}` : "";
        const res = await apiRequest("GET", `/api/objects/multipart/${uploadId}/${partNumber}${qs}`, undefined);
        const data = (await res.json()) as { url: string; headers?: Record<string, string> };
        return { url: data.url, headers: data.headers };
      },

      completeMultipartUpload: async (_file, { uploadId }) => {
        const res = await apiRequest("POST", `/api/objects/multipart/${uploadId}/complete`, {});
        const data = (await res.json()) as { location: string };
        return { location: data.location };
      },

      abortMultipartUpload: async (_file, { uploadId }) => {
        await apiRequest("DELETE", `/api/objects/multipart/${uploadId}`, undefined).catch(() => {});
      },
    });

    instance.on("complete", async (result) => {
      const successfulFiles = result.successful ?? [];
      const failedFiles = result.failed ?? [];

      if (successfulFiles.length === 0 && failedFiles.length > 0) {
        toastRef.current({
          title: "Upload failed",
          description: `${failedFiles.length} file(s) could not be uploaded. Please try again.`,
          variant: "destructive",
        });
        setShowModal(false);
        return;
      }

      if (successfulFiles.length === 0) {
        setShowModal(false);
        return;
      }

      const intentIds = successfulFiles
        .map((f) => intentMapRef.current.get(f.id))
        .filter((id): id is string => !!id);

      intentMapRef.current.clear();

      try {
        let objectPaths: string[] = [];
        if (intentIds.length > 0) {
          objectPaths = await confirmIntents(intentIds);
        }

        let pathIdx = 0;
        const enrichedResult: UploadResult<Record<string, unknown>, Record<string, unknown>> = {
          ...result,
          successful: successfulFiles.map((f) => ({
            ...f,
            uploadURL: objectPaths[pathIdx++] ?? f.uploadURL,
          })),
        };
        onCompleteRef.current?.(enrichedResult);
      } catch (err) {
        console.error("Upload confirm failed:", err);
        toastRef.current({
          title: "Upload processing error",
          description: "Files uploaded but could not be confirmed. Please try again.",
          variant: "destructive",
        });
        onCompleteRef.current?.({
          ...result,
          successful: successfulFiles.map((f) => ({
            ...f,
            uploadURL: f.uploadURL ?? "",
          })),
          failed: failedFiles,
        });
      } finally {
        setShowModal(false);
      }
    });

    return instance;
  });

  const addFilesToUppy = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);

      fileArray.forEach((file) => {
        try {
          uppy.addFile({
            name: file.name,
            type: file.type,
            data: file,
            source: "local",
          });
        } catch (error) {
          console.warn("File add error:", error);
          toast({ title: "File error", description: error instanceof Error ? error.message : "Could not add file.", variant: "destructive" });
        }
      });

      if (fileArray.length > 0) {
        setShowModal(true);
      }
    },
    [uppy, toast]
  );

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounter.current = 0;
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        addFilesToUppy(e.dataTransfer.files);
      }
    },
    [addFilesToUppy]
  );

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFilesToUppy(e.target.files);
        e.target.value = "";
      }
    },
    [addFilesToUppy]
  );

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        multiple={maxNumberOfFiles > 1}
        accept={allowedFileTypes?.join(",")}
        className="hidden"
        onChange={handleFileInput}
        data-testid={testId ? `${testId}-input` : undefined}
      />
      <div
        onClick={handleClick}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="cursor-pointer transition-colors pl-[10px] pr-[10px] pt-[3px] pb-[3px] ml-[0px] mr-[0px] rounded-sm text-center mt-[0px] mb-[0px] flex justify-center items-center bg-[#fa6b1b00]"
        data-testid={testId}
      >
        {children}
      </div>
      <DashboardModal
        uppy={uppy}
        open={showModal}
        onRequestClose={() => setShowModal(false)}
        proudlyDisplayPoweredByUppy={false}
      />
    </div>
  );
}
