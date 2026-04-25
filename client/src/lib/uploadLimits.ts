// Effectively-unlimited per-file storage cap shared by every ObjectUploader
// call site. The underlying upload flow uses chunked/resumable uploads above
// 10 MB, so multi-GB uploads are supported. Keep this in lock-step with
// MAX_STORAGE_FILE_SIZE in server/fileValidation.ts so the client never
// previews a file the server would later reject.
export const MAX_STORAGE_FILE_SIZE = 20 * 1024 * 1024 * 1024; // 20 GB
