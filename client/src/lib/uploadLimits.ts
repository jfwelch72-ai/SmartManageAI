// Effectively-unlimited per-file storage cap shared by every ObjectUploader
// call site. The underlying upload flow uses chunked/resumable uploads above
// 10 MB, so multi-GB uploads are supported. Keep this in lock-step with
// MAX_STORAGE_FILE_SIZE in server/fileValidation.ts so the client never
// previews a file the server would later reject. Construction projects
// routinely upload large drawing sets and BIM/LiDAR files, especially in the
// Plans & Takeoff step, so this stays generous on purpose.
// Task #2405 — bumped from 20 GB to 32 GB so estimators can drop in 25 GB
// civil plansets without the client previewing a file the server would later
// reject. Keep this in lock-step with MAX_STORAGE_FILE_SIZE in
// server/fileValidation.ts.
export const MAX_STORAGE_FILE_SIZE = 32 * 1024 * 1024 * 1024; // 32 GB

// Per-batch file count cap shared by every multi-file ObjectUploader call site
// (bid plans, project plans, change orders, document attachments, submittals,
// heavy-civil multi-doc fields, warranty, punch list, etc.). 50 was picked to
// cover real construction batches in one shot — full plan sets as individual
// PDFs (typically 20–80 sheets), daily-report photo dumps (10–40 photos), and
// punch-list evidence (5–30 photos) — without pushing Uppy's per-file
// preview/progress list into sluggish territory on lower-end laptops and
// tablets, which is exactly the field-device profile we ship for. Users can
// always run a second batch right after; there is no cap on total files per
// bid/project. Single-file pickers (avatar, company logo, single LiDAR scan,
// single receipt, single project media item, equipment maintenance photo,
// asset handover doc, individual heavy-civil DOT cert slot) are deliberately
// exempt and stay at maxNumberOfFiles={1} — they fill one form field and must
// not silently turn into multi-uploaders.
export const MAX_BATCH_UPLOAD_FILES = 50;

// Canonical helper-line copy that sits next to every multi-file ObjectUploader
// trigger so users see the per-batch cap *before* they drop 80 plan PDFs and
// Uppy throws a "you can only upload 50 files at a time" toast at them. Keep
// this wording identical across call sites — the task #2044 fix exists exactly
// because each uploader was either silent or had its own slightly different
// phrasing. The constant interpolates MAX_BATCH_UPLOAD_FILES so bumping the
// cap in one place updates every helper line automatically.
export const MAX_BATCH_UPLOAD_HELPER_TEXT = `Up to ${MAX_BATCH_UPLOAD_FILES} files per batch`;
