import {
  activityFromGoogle, buildGoogleEventPayload, googleEventIdForRoutine,
  googleTimes, hasBidirectionalConflict,
} from "./calendar-mapping.ts";

Deno.test("Google → Lotti maps timed and all-day events in the configured timezone", () => {
  const timed = googleTimes({
    id: "g1",
    start: { dateTime: "2026-08-22T15:00:00-03:00", timeZone: "America/Sao_Paulo" },
    end: { dateTime: "2026-08-22T16:00:00-03:00", timeZone: "America/Sao_Paulo" },
  }, "UTC");
  const allDay = googleTimes({
    id: "g2", start: { date: "2026-08-22" }, end: { date: "2026-08-23" },
  }, "America/Sao_Paulo");

  if (!timed || !allDay) throw new Error("times missing");
  if (timed.startAt !== "2026-08-22T18:00:00.000Z") throw new Error("timed conversion failed");
  if (!allDay.allDay || allDay.startAt !== "2026-08-22T03:00:00.000Z") throw new Error("all-day conversion failed");
  if (activityFromGoogle("Visita ao imóvel Florença") !== "visita_imovel") throw new Error("activity mapping failed");
});

Deno.test("Lotti → Google uses deterministic IDs and partial mode hides CRM personal data", () => {
  const event = {
    id: "11111111-2222-4333-8444-555555555555",
    organization_id: "org-1",
    title: "Visita com Maria Silva",
    description: "Telefone privado: 62999999999",
    activity_type: "visita_imovel",
    location: "Rua privada, 10",
    visibility: "team",
    start_at: "2026-08-22T18:00:00.000Z",
    end_at: "2026-08-22T19:00:00.000Z",
    timezone: "America/Sao_Paulo",
    recurrence_rule: "FREQ=WEEKLY",
    source: "lotti",
    sync_version: 3,
  };
  const payload = buildGoogleEventPayload(event, "partial", "Jardim Europa · São Paulo");
  const id = googleEventIdForRoutine(event.id);

  if (id !== "lotti11111111222243338444555555555555") throw new Error("event id is not deterministic");
  if (payload.summary !== "Visita imobiliária — Jardim Europa · São Paulo") throw new Error("partial summary failed");
  if (payload.description !== undefined || String(payload.summary).includes("Maria")) throw new Error("partial mode leaked PII");
  if (payload.extendedProperties.private.lottiSyncVersion !== "3") throw new Error("sync metadata missing");
  if (payload.recurrence?.[0] !== "RRULE:FREQ=WEEKLY") throw new Error("recurrence missing");
});

Deno.test("busy-only mode sends no title, description or address", () => {
  const payload = buildGoogleEventPayload({
    id: "event-1", organization_id: "org-1", title: "Cliente secreto", description: "CPF",
    activity_type: "reuniao", location: "Endereço", visibility: "private",
    start_at: "2026-08-22T18:00:00.000Z", end_at: "2026-08-22T19:00:00.000Z",
  }, "busy_only", null);
  if (payload.summary !== "Ocupado" || payload.description !== undefined || payload.location !== undefined) {
    throw new Error("busy-only leaked details");
  }
});

Deno.test("simultaneous Google and Lotti changes are marked as conflict", () => {
  if (!hasBidirectionalConflict("2026-08-22T12:05:00Z", "2026-08-22T12:00:00Z", 4, 3)) {
    throw new Error("conflict was not detected");
  }
  if (hasBidirectionalConflict("2026-08-22T11:55:00Z", "2026-08-22T12:00:00Z", 4, 3)) {
    throw new Error("stale Google version caused conflict");
  }
});
