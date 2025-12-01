import { Directory, Paths, File as ExpoFile } from "expo-file-system";
import { authHeader } from "../api/api";

export type UploadItem = {
  id: string;
  uri: string;
};

/**
 * Helper function to ensure local o2data dir exists
 * @param patientId patient's patient id
 */
export const ensureDir = async (patientId: string) => {
  try {
    const dir = getO2dataDir(patientId);
    const ok = dir.exists === true;

    if (!ok) {
      await dir.create({ intermediates: true });
    }

    return dir;
  } catch (e) {
    console.error("Error@history/index.tsx/ensureDir: ", e);
    throw e;
  }
};

export const getO2dataDir = (patientId: string) =>
  new Directory(Paths.document, "o2data", patientId);

/**
 * Upload a single CSV for a patient.
 */
export const uploadCsv = async (params: {
  patientId: string;
  item: UploadItem;
  baseURL: string;
}) => {
  const { patientId, item, baseURL } = params;
  if (!patientId) throw new Error("uploadCsv: missing patientId");
  if (!baseURL) throw new Error("uploadCsv: missing baseURL");

  const form = new FormData();
  form.append("patient_id", patientId);
  form.append("silent", "1");
  form.append("csv", {
    uri: item.uri,
    name: item.id,
    type: "text/csv",
  } as any);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (authHeader) headers.Authorization = authHeader;

  const res = await fetch(`${baseURL}/staff/o2ring-data/upload.php`, {
    method: "POST",
    headers,
    body: form,
  });

  const data = await res.json().catch(() => ({} as any));

  if (res.status === 409) {
    // duplicate filename -> treat as uploaded
    return true;
  }

  if (res.ok && (data?.status === 200 || res.status === 200)) {
    return true;
  }

  throw new Error(
    `uploadCsv failed: status=${res.status}, payload=${JSON.stringify(data)}`
  );
};

/**
 * Upload a list of CSV items; returns IDs that succeeded.
 */
export const uploadPendingCsvs = async (params: {
  patientId: string;
  items: UploadItem[];
  baseURL: string;
}) => {
  const { patientId, items, baseURL } = params;
  const uploaded: string[] = [];
  for (const item of items) {
    try {
      const ok = await uploadCsv({ patientId, item, baseURL });
      if (ok) uploaded.push(item.id);
    } catch (e) {
      // keep going; caller can inspect uploaded list
      console.error("uploadPendingCsvs error:", e);
    }
  }
  return uploaded;
};
