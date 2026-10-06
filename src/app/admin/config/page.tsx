import Link from "next/link";
import { revalidatePath } from "next/cache";
import { loadConfig, saveConfig } from "@/lib/db";
import { mergeConfig, semanticErrors, validateConfig } from "@/lib/config";
import { defaultConfig } from "@config/screener.config";

export const dynamic = "force-dynamic";

async function save(formData: FormData) {
  "use server";
  const raw = String(formData.get("config") ?? "");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return; }
  const merged = mergeConfig(defaultConfig, parsed as Record<string, unknown>);
  if (validateConfig(merged).length || semanticErrors(merged).length) return; // invalid edits are ignored; the page re-shows current config
  await saveConfig(merged);
  revalidatePath("/admin/config");
}

export default async function ConfigPage() {
  const cfg = await loadConfig();
  return (
    <>
      <p><Link href="/admin">← Back</Link></p>
      <h1>Config</h1>
      <p style={{ fontSize: 13 }}>Edit JSON and save. Invalid structure/weights are rejected (nothing is saved). Takes effect on the next run.</p>
      <form action={save}>
        <textarea name="config" defaultValue={JSON.stringify(cfg, null, 2)} rows={36} style={{ width: "100%", fontFamily: "monospace", fontSize: 13 }} />
        <button type="submit" style={{ marginTop: 8, padding: "8px 16px" }}>Save</button>
      </form>
    </>
  );
}
