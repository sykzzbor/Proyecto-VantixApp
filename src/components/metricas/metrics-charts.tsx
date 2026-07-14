"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const ACCENT = "#8eacff";
const AXIS = "#8b93a7";
const GRID = "rgba(255,255,255,0.06)";
export const CHART_PALETTE = [
  "#8eacff",
  "#5b8def",
  "#34d399",
  "#fbbf24",
  "#f87171",
  "#a78bfa",
];

type TooltipEntry = {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
};

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      {label !== undefined && label !== "" && (
        <p className="mb-1 font-medium text-foreground">{label}</p>
      )}
      {payload.map((entry, index) => (
        <p key={index} className="flex items-center gap-1.5 text-muted-foreground">
          <span
            aria-hidden
            className="inline-block size-2 rounded-[2px]"
            style={{ backgroundColor: entry.color ?? ACCENT }}
          />
          {entry.name}:{" "}
          <span className="font-medium text-foreground">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

function shortDay(value: string): string {
  const parts = value.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : value;
}

export function ConversationsByDayChart({
  data,
}: {
  data: { day: string; count: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
        <defs>
          <linearGradient id="convFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.45} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="day"
          tickFormatter={shortDay}
          tick={{ fontSize: 11, fill: AXIS }}
          axisLine={false}
          tickLine={false}
          minTickGap={16}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: AXIS }}
          axisLine={false}
          tickLine={false}
          width={30}
        />
        <Tooltip
          content={<ChartTooltip />}
          cursor={{ stroke: GRID }}
          labelFormatter={(value) => shortDay(String(value))}
        />
        <Area
          type="monotone"
          dataKey="count"
          name="Conversaciones"
          stroke={ACCENT}
          strokeWidth={2}
          fill="url(#convFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ByHourChart({ data }: { data: { hour: number; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
        <XAxis
          dataKey="hour"
          tickFormatter={(hour) => `${hour}h`}
          tick={{ fontSize: 10, fill: AXIS }}
          axisLine={false}
          tickLine={false}
          interval={2}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: AXIS }}
          axisLine={false}
          tickLine={false}
          width={30}
        />
        <Tooltip
          content={<ChartTooltip />}
          cursor={{ fill: GRID }}
          labelFormatter={(value) => `${String(value)}:00 h`}
        />
        <Bar dataKey="count" name="Mensajes" fill={ACCENT} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ChannelBarChart({
  data,
}: {
  data: { channel: string; count: number }[];
}) {
  const labelled = data.map((entry) => ({
    ...entry,
    label:
      entry.channel === "whatsapp"
        ? "WhatsApp"
        : entry.channel === "test"
          ? "Prueba"
          : entry.channel,
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart
        data={labelled}
        layout="vertical"
        margin={{ top: 4, right: 12, bottom: 0, left: 8 }}
      >
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fontSize: 11, fill: AXIS }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 12, fill: AXIS }}
          axisLine={false}
          tickLine={false}
          width={70}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: GRID }} />
        <Bar dataKey="count" name="Mensajes" radius={[0, 3, 3, 0]}>
          {labelled.map((entry, index) => (
            <Cell
              key={entry.channel}
              fill={CHART_PALETTE[index % CHART_PALETTE.length]}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SharePieChart({
  data,
}: {
  data: { name: string; value: number; color: string }[];
}) {
  const total = data.reduce((sum, entry) => sum + entry.value, 0);
  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width="55%" height={180}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={45}
            outerRadius={72}
            paddingAngle={2}
            stroke="none"
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="flex-1 space-y-2 text-sm">
        {data.map((entry) => {
          const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0;
          return (
            <li key={entry.name} className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-[3px]"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground">{entry.name}</span>
              <span className="ml-auto font-medium tabular-nums">
                {entry.value}
              </span>
              <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">
                {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
