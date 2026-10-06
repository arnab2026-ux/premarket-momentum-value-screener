import Link from "next/link";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const { data } = await db().from("reports").select("html").eq("run_date", date).maybeSingle();
  return (
    <>
      <p><Link href="/admin">← All reports</Link></p>
      {data ? (
        // sandboxed: the stored email HTML cannot run scripts or touch the admin origin
        <iframe title={`Report ${date}`} sandbox="" srcDoc={data.html as string} style={{ width: "100%", height: "85vh", border: "1px solid #d1d5db", background: "#fff" }} />
      ) : <p>No report for {date}.</p>}
    </>
  );
}
