import { describe, it, expect } from 'vitest';
import { computePriority, TICKET_STATUS_TRANSITIONS, ticketNumberFor, assetCodeFor } from '@gestao-ti/shared';
import { addSlaMinutes } from '../src/lib/sla.js';

const basePolicy = {
  mode: 'COMERCIAL' as const,
  businessStart: '08:00',
  businessEnd: '18:00',
  workdays: '1,2,3,4,5',
  firstResponseP1: 10, firstResponseP2: 30, firstResponseP3: 240, firstResponseP4: 600,
  resolutionP1: 240, resolutionP2: 480, resolutionP3: 2400, resolutionP4: 12000,
};

describe('Matriz de prioridade (impacto × urgência)', () => {
  it('loja parada = P1', () => {
    expect(computePriority('UM_SETOR', 'OPERACAO_PARADA')).toBe('P1');
    expect(computePriority('TODA_EMPRESA', 'RISCO_IMEDIATO')).toBe('P1');
  });
  it('problema individual com alternativa = P3/P4', () => {
    expect(computePriority('UMA_PESSOA', 'EXISTE_ALTERNATIVA')).toBe('P4');
    expect(computePriority('UMA_PESSOA', 'PARCIALMENTE_PREJUDICADA')).toBe('P3');
  });
  it('setor severamente afetado = P2', () => {
    expect(computePriority('ALGUMAS_PESSOAS', 'ATIVIDADE_BLOQUEADA')).toBe('P2');
  });
});

describe('Transições de status', () => {
  it('chamado cancelado não sai do estado', () => {
    expect(TICKET_STATUS_TRANSITIONS.CANCELADO).toHaveLength(0);
  });
  it('resolvido pode fechar ou reabrir', () => {
    expect(TICKET_STATUS_TRANSITIONS.RESOLVIDO).toContain('FECHADO');
    expect(TICKET_STATUS_TRANSITIONS.RESOLVIDO).toContain('EM_ATENDIMENTO');
  });
  it('novo não pode ir direto para fechado', () => {
    expect(TICKET_STATUS_TRANSITIONS.NOVO).not.toContain('FECHADO');
  });
});

describe('Numeração legível', () => {
  it('formata TI-2026-000001 e ATI-2026-000042', () => {
    expect(ticketNumberFor(2026, 1)).toBe('TI-2026-000001');
    expect(assetCodeFor(2026, 42)).toBe('ATI-2026-000042');
  });
});

describe('Cálculo de SLA', () => {
  it('modo corrido soma direto', () => {
    const start = new Date('2026-07-17T10:00:00');
    const due = addSlaMinutes(start, 120, { ...basePolicy, mode: 'CORRIDO' });
    expect(due.getTime()).toBe(start.getTime() + 120 * 60_000);
  });

  it('modo comercial não conta a noite', () => {
    // Sexta 17:00 + 120min úteis → sexta consome 60min (até 18h), sábado/domingo pulam, segunda 09:00
    const start = new Date('2026-07-17T17:00:00'); // sexta
    const due = addSlaMinutes(start, 120, basePolicy);
    expect(due.getDay()).toBe(1); // segunda
    expect(due.getHours()).toBe(9);
  });

  it('modo comercial pula fim de semana', () => {
    const sabado = new Date('2026-07-18T10:00:00'); // sábado
    const due = addSlaMinutes(sabado, 60, basePolicy);
    expect(due.getDay()).toBe(1); // segunda
    expect(due.getHours()).toBe(9);
  });

  it('modo comercial pula feriado', () => {
    const start = new Date('2026-07-16T17:30:00'); // quinta
    const feriado = new Date('2026-07-17T00:00:00'); // sexta é feriado
    const due = addSlaMinutes(start, 60, basePolicy, [feriado]);
    expect(due.getDay()).toBe(1); // segunda (sexta pulada, fds pulado)
  });

  it('antes do expediente começa a contar no início do expediente', () => {
    const start = new Date('2026-07-17T06:00:00'); // sexta 6h
    const due = addSlaMinutes(start, 30, basePolicy);
    expect(due.getHours()).toBe(8);
    expect(due.getMinutes()).toBe(30);
  });
});
