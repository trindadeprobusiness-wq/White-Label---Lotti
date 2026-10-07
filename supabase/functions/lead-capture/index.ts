// Desde a virada (2026-10-07) quem grava é a API do Railway; esta função só repassa.
// A versão anterior está no histórico do git.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { repassarParaRailway } from '../_shared/repassar-railway.ts';

serve(repassarParaRailway('/api/publico/leads'));
