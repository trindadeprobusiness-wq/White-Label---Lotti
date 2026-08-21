export type GoogleCalendarEvent = {
  id: string;
  status?: string;
  etag?: string;
  updated?: string;
  summary?: string;
  description?: string;
  location?: string;
  visibility?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  recurrence?: string[];
};

export type GooglePrivacyMode = "full" | "partial" | "busy_only";

function zonedMidnight(date: string, timeZone: string): string {
  const guess = new Date(`${date}T00:00:00.000Z`);
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(guess).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    return new Date(guess.getTime() - (represented - guess.getTime())).toISOString();
  } catch {
    return guess.toISOString();
  }
}

export function googleTimes(event: GoogleCalendarEvent, fallbackTimeZone: string) {
  const timeZone = event.start?.timeZone || event.end?.timeZone || fallbackTimeZone || "America/Sao_Paulo";
  const allDay = !!event.start?.date;
  const startAt = event.start?.dateTime || (event.start?.date ? zonedMidnight(event.start.date, timeZone) : null);
  const endAt = event.end?.dateTime || (event.end?.date ? zonedMidnight(event.end.date, timeZone) : null);
  if (!startAt || !endAt) return null;
  return { startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString(), allDay, timeZone };
}

export function activityFromGoogle(summary = "") {
  const value = summary.toLowerCase();
  if (value.includes("visita")) return "visita_imovel";
  if (value.includes("vistoria")) return "vistoria";
  if (value.includes("reuni")) return "reuniao";
  if (value.includes("assinatura")) return "assinatura_contrato";
  if (value.includes("ligação") || value.includes("ligacao")) return "ligacao";
  return "outro";
}

export function googleEventIdForRoutine(eventId: string): string {
  return `lotti${eventId.replace(/-/g, "")}`;
}

export function hasBidirectionalConflict(
  googleUpdatedAt: string | null | undefined,
  lastSyncedAt: string | null | undefined,
  localVersion: number,
  mappedVersion: number,
): boolean {
  const googleChanged = !!googleUpdatedAt
    && new Date(googleUpdatedAt).getTime() > new Date(lastSyncedAt || 0).getTime();
  return googleChanged && localVersion > mappedVersion;
}

export function buildGoogleEventPayload(
  event: Record<string, unknown>,
  privacyMode: GooglePrivacyMode,
  partialLocation: string | null,
) {
  const activityType = String(event.activity_type || "outro");
  const typeLabel = activityType === "visita_imovel" ? "Visita imobiliária"
    : activityType === "reuniao" ? "Reunião imobiliária"
    : activityType === "vistoria" ? "Vistoria"
    : "Compromisso Lotti";
  const summary = privacyMode === "full"
    ? String(event.title || "Compromisso Lotti")
    : privacyMode === "busy_only"
      ? "Ocupado"
      : `${typeLabel}${partialLocation ? ` — ${partialLocation}` : ""}`;
  const allDay = !!event.all_day;
  const recurrenceRule = event.recurrence_rule ? String(event.recurrence_rule).replace(/^RRULE:/, "") : null;
  return {
    summary,
    description: privacyMode === "full" ? event.description || undefined : undefined,
    location: privacyMode === "busy_only" ? undefined : event.location || undefined,
    visibility: event.visibility === "private" ? "private" : "default",
    transparency: "opaque",
    start: allDay
      ? { date: String(event.start_at).slice(0, 10) }
      : { dateTime: event.start_at, timeZone: event.timezone || "America/Sao_Paulo" },
    end: allDay
      ? { date: String(event.end_at).slice(0, 10) }
      : { dateTime: event.end_at, timeZone: event.timezone || "America/Sao_Paulo" },
    recurrence: recurrenceRule ? [`RRULE:${recurrenceRule}`] : undefined,
    reminders: { useDefault: true },
    extendedProperties: {
      private: {
        lottiEventId: String(event.id),
        lottiOrgId: String(event.organization_id),
        lottiSource: String(event.source || "lotti"),
        lottiSyncVersion: String(event.sync_version || 1),
      },
    },
  };
}
