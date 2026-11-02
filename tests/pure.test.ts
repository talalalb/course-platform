import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { toCsv } from '@/lib/csv';
import { computeStats, needsAttention, summarizeByStudent, type PairRow } from '@/lib/metrics';
import { utcToZonedInput, zonedLocalToUtc } from '@/lib/time';
import { canStillSubmit } from '@/lib/submissions';

describe('passwords', () => {
  it('verifies the right password only', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong horse', hash)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('x', null)).toBe(false);
  });
});

describe('time zone conversion', () => {
  it('treats deadlines as Riyadh time', () => {
    expect(zonedLocalToUtc('2026-11-05T23:59', 'Asia/Riyadh')?.toISOString()).toBe('2026-11-05T20:59:00.000Z');
    expect(utcToZonedInput(new Date('2026-11-05T20:59:00Z'), 'Asia/Riyadh')).toBe('2026-11-05T23:59');
    expect(zonedLocalToUtc('not a date', 'Asia/Riyadh')).toBeNull();
  });

  it('handles daylight-saving zones', () => {
    expect(zonedLocalToUtc('2026-07-01T12:00', 'Europe/London')?.toISOString()).toBe('2026-07-01T11:00:00.000Z');
    expect(zonedLocalToUtc('2026-01-01T12:00', 'Europe/London')?.toISOString()).toBe('2026-01-01T12:00:00.000Z');
  });
});

describe('CSV export', () => {
  it('opens in Excel with Arabic and cannot run formulas', () => {
    const csv = toCsv([
      ['الاسم', 'قيمة'],
      ['=HYPERLINK("http://x")', 'a,b'],
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain('"a,b"');
  });
});

describe('deadline rules', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  it('allows on-time work, marks late work, blocks reviewed or closed work', () => {
    expect(canStillSubmit({ dueAt: new Date('2026-11-03T00:00:00Z'), allowLate: false }, null, now)).toEqual({ ok: true, late: false });
    expect(canStillSubmit({ dueAt: new Date('2026-11-01T00:00:00Z'), allowLate: true }, null, now)).toEqual({ ok: true, late: true });
    expect(canStillSubmit({ dueAt: new Date('2026-11-01T00:00:00Z'), allowLate: false }, null, now).ok).toBe(false);
    expect(canStillSubmit({ dueAt: new Date('2026-11-03T00:00:00Z'), allowLate: true }, { status: 'reviewed' }, now).ok).toBe(false);
  });
});

describe('dashboard numbers', () => {
  const base = {
    groupId: 'g',
    groupName: 'G',
    courseId: 'c',
    courseTitle: 'C',
    studentName: 'S',
    studentEmail: 's@x',
    maxScore: 20,
    assignmentTitle: 'A',
    submittedAt: null,
  };
  const past = new Date('2026-10-01T00:00:00Z');
  const future = new Date('2026-12-01T00:00:00Z');
  const now = new Date('2026-11-02T00:00:00Z');
  const rows: PairRow[] = [
    { ...base, studentId: 's1', assignmentId: 'a1', dueAt: past, submissionId: 'x1', status: 'reviewed', isLate: false, grade: 15 },
    { ...base, studentId: 's1', assignmentId: 'a2', dueAt: past, submissionId: null, status: null, isLate: null, grade: null },
    { ...base, studentId: 's1', assignmentId: 'a3', dueAt: future, submissionId: 'x3', status: 'submitted', isLate: false, grade: null },
    { ...base, studentId: 's2', assignmentId: 'a1', dueAt: past, submissionId: 'x4', status: 'submitted', isLate: true, grade: null },
    { ...base, studentId: 's2', assignmentId: 'a2', dueAt: past, submissionId: 'x5', status: 'reviewed', isLate: false, grade: 10 },
    { ...base, studentId: 's3', assignmentId: null, dueAt: null, submissionId: null, status: null, isLate: null, grade: null },
  ];

  it('computes rates, missing work and averages from due assignments only', () => {
    const s = computeStats(rows, now);
    expect(s.due).toBe(4);
    expect(s.submittedDue).toBe(3);
    expect(s.submissionRate).toBe(75);
    expect(s.missing).toBe(1);
    expect(s.late).toBe(1);
    expect(s.pending).toBe(2);
    expect(s.averageGrade).toBe(62.5); // (75% + 50%) / 2
  });

  it('flags students with missing work or a low average', () => {
    const students = summarizeByStudent(rows, now);
    const flagged = needsAttention(students).map((x) => x.studentId);
    expect(flagged).toContain('s1'); // missing a2
    expect(flagged).toContain('s2'); // average 50%
    expect(flagged).not.toContain('s3');
  });
});
