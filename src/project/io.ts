import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Project } from "../types/project";

export async function pickImagePath(): Promise<string | null> {
  const path = await open({
    multiple: false,
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
    ],
  });
  return typeof path === "string" ? path : null;
}

export async function saveProjectAs(project: Project): Promise<string | null> {
  const path = await save({
    filters: [{ name: "Thumbl Project", extensions: ["thumbl.json"] }],
    defaultPath: "project.thumbl.json",
  });
  if (!path) return null;
  await writeTextFile(path, JSON.stringify(project, null, 2));
  return path;
}

export async function openProject(): Promise<Project | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: "Thumbl Project", extensions: ["json"] }],
  });
  if (typeof path !== "string") return null;
  const text = await readTextFile(path);
  return JSON.parse(text) as Project;
}
