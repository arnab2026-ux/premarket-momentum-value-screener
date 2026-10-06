import Link from "next/link";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Admin() {
  const [reports, runs, errors] = await Promise.all([
    db().from("reports").select("run_date, top_tickers, sent_at, recipient").order("run_date", { ascending: false }).limit(60),
    db().from("runs").select("run_date, status, attempts, error").order("run_date", { ascending: false }).limit(10),
    db().from("errors").select("created_at, run_date, stage, message").order("created_at", { ascending: false }).limit(10),
  ]);
  const th = { textAlign: "left" as const, padding: 6, borderBottom: "1px solid #d1d5db" };
  return (
    <>
      <h1>Screener admin</h1>
      <p><Link href="/admin/config">Edit config →</Link></p>
      <h2>Reports</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}>
        <thead><tr><th style={th}>Date</th><th style={th}>Names</th><th style={th}>Sent</th><th style={th}>To</th></tr></thead>
        <tbody>
          {(reports.data ?? []).map((r) => (
            <tr key={r.run_date}>
              <td style={{ padding: 6 }}><Link href={`/admin/report/${r.run_date}`}>{r.run_date}</Link></td>
              <td style={{ padding: 6 }}>{(r.top_tickers as string[]).length}</td>
              <td style={{ padding: 6 }}>{r.sent_at ?? "not sent"}</td>
              <td style={{ padding: 6 }}>{r.recipient}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Recent runs</h2>
      <ul>{(runs.data ?? []).map((r) => <li key={r.run_date}>{r.run_date}: <b>{r.status}</b> ({r.attempts} attempts){r.error ? ` – ${r.error}` : ""}</li>)}</ul>
      <h2>Recent errors</h2>
      <ul>{(errors.data ?? []).map((e, i) => <li key={i}>{e.created_at} [{e.stage}] {e.message}</li>)}</ul>
    </>
  );
}
