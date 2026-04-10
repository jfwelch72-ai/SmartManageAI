import { logInfo, logError } from "../../../utils/logger";

const STACKCT_API_BASE = "https://api.stackct.com/api/v2";

export interface StackCTProject {
  id: string;
  name: string;
  bidDate?: string;
  status?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  createdDate?: string;
  modifiedDate?: string;
}

export interface StackCTFolder {
  id: string;
  name: string;
  projectId: string;
  parentId?: string;
}

export interface StackCTFile {
  id: string;
  name: string;
  folderId: string;
  projectId: string;
  size?: number;
  mimeType?: string;
  uploadedDate?: string;
  downloadUrl?: string;
}

export interface StackCTTakeoff {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  items?: StackCTTakeoffItem[];
  createdDate?: string;
  modifiedDate?: string;
}

export interface StackCTTakeoffItem {
  id: string;
  takeoffId: string;
  description: string;
  quantity: number;
  unit: string;
  unitCost?: number;
  totalCost?: number;
  category?: string;
  notes?: string;
}

async function stackctFetch(
  accessToken: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${STACKCT_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      logError("STACK CT API error", { status: response.status, body: text, endpoint });
      throw new Error(`STACK CT API error ${response.status}: ${text}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return response.json();
    }
    return response.text();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

export async function listProjects(accessToken: string): Promise<StackCTProject[]> {
  logInfo("STACK CT: Listing projects");
  const data = await stackctFetch(accessToken, "/projects");
  return data?.projects || data || [];
}

export async function getProject(accessToken: string, projectId: string): Promise<StackCTProject> {
  logInfo("STACK CT: Getting project", { projectId });
  return stackctFetch(accessToken, `/projects/${projectId}`);
}

export async function createProject(accessToken: string, project: Partial<StackCTProject>): Promise<StackCTProject> {
  logInfo("STACK CT: Creating project", { name: project.name });
  return stackctFetch(accessToken, "/projects", {
    method: "POST",
    body: JSON.stringify(project),
  });
}

export async function updateProject(accessToken: string, projectId: string, project: Partial<StackCTProject>): Promise<StackCTProject> {
  logInfo("STACK CT: Updating project", { projectId });
  return stackctFetch(accessToken, `/projects/${projectId}`, {
    method: "PUT",
    body: JSON.stringify(project),
  });
}

export async function listFolders(accessToken: string, projectId: string): Promise<StackCTFolder[]> {
  logInfo("STACK CT: Listing folders", { projectId });
  const data = await stackctFetch(accessToken, `/projects/${projectId}/folders`);
  return data?.folders || data || [];
}

export async function createFolder(accessToken: string, projectId: string, name: string, parentId?: string): Promise<StackCTFolder> {
  logInfo("STACK CT: Creating folder", { projectId, name });
  return stackctFetch(accessToken, `/projects/${projectId}/folders`, {
    method: "POST",
    body: JSON.stringify({ name, parentId }),
  });
}

export async function listFiles(accessToken: string, projectId: string, folderId?: string): Promise<StackCTFile[]> {
  logInfo("STACK CT: Listing files", { projectId, folderId });
  const endpoint = folderId
    ? `/projects/${projectId}/folders/${folderId}/files`
    : `/projects/${projectId}/files`;
  const data = await stackctFetch(accessToken, endpoint);
  return data?.files || data || [];
}

export async function downloadFile(accessToken: string, projectId: string, fileId: string): Promise<ArrayBuffer> {
  logInfo("STACK CT: Downloading file", { projectId, fileId });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${STACKCT_API_BASE}/projects/${projectId}/files/${fileId}/download`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`STACK CT file download failed: ${response.status}`);
    }

    return response.arrayBuffer();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

export async function uploadFile(
  accessToken: string,
  projectId: string,
  folderId: string,
  fileName: string,
  fileBuffer: Buffer,
  mimeType: string = "application/pdf"
): Promise<StackCTFile> {
  logInfo("STACK CT: Uploading file", { projectId, folderId, fileName });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const boundary = `----FormBoundary${Date.now()}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const response = await fetch(`${STACKCT_API_BASE}/projects/${projectId}/folders/${folderId}/files`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`STACK CT file upload failed: ${response.status}: ${text}`);
    }

    return response.json();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

export async function listTakeoffs(accessToken: string, projectId: string): Promise<StackCTTakeoff[]> {
  logInfo("STACK CT: Listing takeoffs", { projectId });
  const data = await stackctFetch(accessToken, `/projects/${projectId}/takeoffs`);
  return data?.takeoffs || data || [];
}

export async function getTakeoff(accessToken: string, projectId: string, takeoffId: string): Promise<StackCTTakeoff> {
  logInfo("STACK CT: Getting takeoff", { projectId, takeoffId });
  return stackctFetch(accessToken, `/projects/${projectId}/takeoffs/${takeoffId}`);
}

export async function createTakeoff(
  accessToken: string,
  projectId: string,
  takeoff: { name: string; description?: string; items?: Partial<StackCTTakeoffItem>[] }
): Promise<StackCTTakeoff> {
  logInfo("STACK CT: Creating takeoff", { projectId, name: takeoff.name });
  return stackctFetch(accessToken, `/projects/${projectId}/takeoffs`, {
    method: "POST",
    body: JSON.stringify(takeoff),
  });
}

export async function testApiConnection(accessToken: string): Promise<{ ok: boolean; message: string }> {
  try {
    await stackctFetch(accessToken, "/projects?limit=1");
    return { ok: true, message: "Connected to STACK CT" };
  } catch (err) {
    return { ok: false, message: `STACK CT API error: ${String(err)}` };
  }
}
