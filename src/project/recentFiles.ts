const KEY = "thumbl_recent_files";
const MAX = 8;

export interface RecentFile {
  path: string;
  name: string;
}

export function getRecentFiles(): RecentFile[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as RecentFile[];
  } catch {
    return [];
  }
}

export function addRecentFile(path: string, name: string): RecentFile[] {
  const list = getRecentFiles().filter((f) => f.path !== path);
  list.unshift({ path, name });
  const next = list.slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function removeRecentFile(path: string): RecentFile[] {
  const next = getRecentFiles().filter((f) => f.path !== path);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
