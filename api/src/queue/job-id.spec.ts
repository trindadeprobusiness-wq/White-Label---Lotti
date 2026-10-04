import { jobId } from './job-id';

describe('jobId', () => {
  it('junta as partes com hífen', () => {
    expect(jobId('agg', 'lotti-abc', 5562999990000)).toBe('agg-lotti-abc-5562999990000');
  });

  it('recusa dois-pontos e espaço, que o BullMQ 5 rejeita', () => {
    expect(() => jobId('agg', 'a:b')).toThrow('jobid_invalido');
    expect(() => jobId('agg', 'a b')).toThrow('jobid_invalido');
  });

  it('recusa id vazio', () => {
    expect(() => jobId()).toThrow('jobid_invalido');
    expect(() => jobId('')).toThrow('jobid_invalido');
  });
});
