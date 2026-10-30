import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import { timeAgo, useLoad } from '../lib/hooks'
import { FloorHeader } from '../App'
import { Badge, Card, Empty, Stat } from '../ui/kit'

type Group = { group: string; applied: number; responses: number; positive: number; responseRate: number; positiveRate: number; enoughData: boolean; avgDaysToResponse: number | null }

export function Analytics() {
  const d = useLoad(() => api.analytics.summary())
  const emails = useLoad(() => api.email.list())
  if (!d.data) return <div className="skeleton h-96 rounded-2xl" />
  const f = d.data.funnel
  return (
    <div>
      <FloorHeader title="Analytics" sub="What’s getting responses. Rates show sample sizes — a 100% rate from two applications doesn’t mean much yet." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Applications" value={f.total} sub={`${f.pending} in progress`} />
        <Stat label="Submitted" value={f.submitted} />
        <Stat label="Responses" value={f.responded} sub={f.submitted ? `${Math.round((f.responded / f.submitted) * 100)}% of submitted` : ''} />
        <Stat label="Interviews" value={f.interviews} tone={f.interviews ? 'ok' : undefined} />
        <Stat label="Offers" value={f.offers} tone={f.offers ? 'brass' : undefined} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Which resume gets responses">
          <GroupTable rows={d.data.byResume} empty="Submit a few applications to compare resume versions." />
        </Card>
        <Card title="Applications per day (last 30 days)">
          <div className="h-[240px]">
            <ResponsiveContainer>
              <BarChart data={d.data.perDay}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(x: string) => x.slice(5)} stroke="#6b685f" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} stroke="#6b685f" fontSize={11} tickLine={false} axisLine={false} width={28} />
                <Tooltip contentStyle={{ background: '#12141b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#ece8de' }} cursor={{ fill: 'rgba(201,169,97,0.08)' }} />
                <Bar dataKey="count" fill="#c9a961" radius={[4, 4, 0, 0]} name="Submitted" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="By source">
          <GroupTable rows={d.data.bySource} empty="No data yet." />
        </Card>
        <Card title="By application platform">
          <GroupTable rows={d.data.byPlatform} empty="No data yet." />
        </Card>
        <Card title="Auto vs. reviewed">
          <GroupTable rows={d.data.byMode} empty="No data yet." />
        </Card>
        <Card title="Recent job emails">
          {!emails.data?.length ? (
            <div className="text-sm text-muted">No emails tracked yet.</div>
          ) : (
            <div className="max-h-[300px] space-y-2 overflow-y-auto">
              {emails.data.slice(0, 40).map((e) => (
                <div key={e.id} className="flex items-start gap-3 text-sm">
                  <Badge tone={e.classification === 'interview' || e.classification === 'offer' ? 'ok' : e.classification === 'rejection' ? 'bad' : 'neutral'}>{e.classification}</Badge>
                  <div className="min-w-0">
                    <div className="truncate">{e.subject}</div>
                    <div className="truncate text-xs text-faint">
                      {e.from} · {timeAgo(e.receivedAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function GroupTable({ rows, empty }: { rows: Group[]; empty: string }) {
  if (!rows.length) return <Empty title="Not enough data yet">{empty}</Empty>
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wider text-muted">
        <tr className="border-b border-line">
          <th className="py-2">Group</th>
          <th className="py-2 text-right">Sent</th>
          <th className="py-2 text-right">Response</th>
          <th className="py-2 text-right">Interview</th>
          <th className="py-2 text-right">Avg. days</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.group} className="border-b border-line/50">
            <td className="py-2 pr-2">
              {r.group} {!r.enoughData && <Badge>small sample</Badge>}
            </td>
            <td className="py-2 text-right tabular-nums">{r.applied}</td>
            <td className="py-2 text-right tabular-nums">
              <div className="flex items-center justify-end gap-2">
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/5">
                  <div className="h-full bg-brass" style={{ width: `${r.responseRate * 100}%` }} />
                </div>
                {Math.round(r.responseRate * 100)}%
              </div>
            </td>
            <td className="py-2 text-right tabular-nums text-ok">{Math.round(r.positiveRate * 100)}%</td>
            <td className="py-2 text-right tabular-nums text-muted">{r.avgDaysToResponse == null ? '—' : r.avgDaysToResponse.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
