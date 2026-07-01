import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { normalizeProject, type Project } from "../types/project";

export async function pickImagePath(): Promise<string | null> {
  const path = await open({
    multiple: false,
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
    ],
  });
  return typeof path === "string" ? path : null;
}

export async function saveProject(project: Project, path: string): Promise<void> {
  await writeTextFile(path, JSON.stringify(project, null, 2));
}

export async function saveProjectAs(project: Project): Promise<string | null> {
  const path = await save({
    filters: [{ name: "Thumbl Project", extensions: ["thumbl.json"] }],
    defaultPath: "project.thumbl.json",
  });
  if (!path) return null;
  await saveProject(project, path);
  return path;
}

export async function openProject(): Promise<{ project: Project; path: string } | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: "Thumbl Project", extensions: ["json"] }],
  });
  if (typeof path !== "string") return null;
  return openProjectFromPath(path);
}

export async function openProjectFromPath(path: string): Promise<{ project: Project; path: string } | null> {
  try {
    const text = await readTextFile(path);
    return { project: normalizeProject(JSON.parse(text) as Project), path };
  } catch {
    return null;
  }
}
