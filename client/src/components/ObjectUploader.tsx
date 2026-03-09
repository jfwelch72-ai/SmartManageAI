import { useState, useCallback, useRef } from "react";
import type { ReactNode, DragEvent } from "react";
import Uppy from "@uppy/core";
import DashboardModal from "@uppy/react/dashboard-modal";
import AwsS3 from "@uppy/aws-s3";
import type { UploadResult } from "@uppy/core";

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  allowedFileTypes?: string[];
  onGetUploadParameters: () => Promise<{
    method: "PUT";
    url: string;
  }>;
  onComplete?: (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>
  ) => void;
  buttonVariant?: "default" | "outline" | "ghost" | "secondary";
  buttonClassName?: string;
  children: ReactNode;
  testId?: string;
}

export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 104857600,
  allowedFileTypes,
  onGetUploadParameters,
  onComplete,
  children,
  testId,
}: ObjectUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [uppy] = useState(() =>
    new Uppy({
      restrictions: {
        maxNumberOfFiles,
        maxFileSize,
        allowedFileTypes,
      },
      autoProceed: false,
    })
      .use(AwsS3, {
        shouldUseMultipart: false,
        getUploadParameters: onGetUploadParameters,
      })
      .on("complete", (result) => {
        onComplete?.(result);
        setShowModal(false);
      })
  );

  const addFilesToUppy = useCallback((files: FileList | File[]) => {
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
      }
    });
    if (fileArray.length > 0) {
      setShowModal(true);
    }
  }, [uppy]);

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

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      addFilesToUppy(e.dataTransfer.files);
    }
  }, [addFilesToUppy]);

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToUppy(e.target.files);
      e.target.value = "";
    }
  }, [addFilesToUppy]);

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
