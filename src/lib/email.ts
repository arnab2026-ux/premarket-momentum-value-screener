import { Resend } from "resend";

function client() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not set");
  return new Resend(key);
}
const from = () => process.env.EMAIL_FROM ?? "Screener <onboarding@resend.dev>";

export async function sendReportEmail(opts: { to: string; subject: string; html: string; csv: string; runDate: string }): Promise<string> {
  const { data, error } = await client().emails.send(
    {
      from: from(), to: [opts.to], subject: opts.subject, html: opts.html,
      attachments: [{ filename: `screener-${opts.runDate}.csv`, content: Buffer.from(opts.csv, "utf8") }],
    },
    { idempotencyKey: `screener-report-${opts.runDate}` }, // protects against double-send on retries
  );
  if (error || !data) throw new Error(`Resend error: ${error?.message ?? "no data"}`);
  return data.id;
}

export async function sendFailureAlert(to: string, runDate: string, message: string) {
  try {
    await client().emails.send({
      from: from(), to: [to], subject: `⚠️ Screener FAILED for ${runDate}`,
      html: `<p>The pre-market screener failed after all retries for <b>${runDate}</b>.</p><pre style="white-space:pre-wrap">${message.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</pre><p>See the <code>errors</code> table / admin page for details.</p>`,
    });
  } catch (e) { console.error("failure alert could not be sent", e); }
}
