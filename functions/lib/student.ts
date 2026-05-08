export const STUDENTS = Array.from({ length: 40 }, (_, i) => `3A${String(i + 1).padStart(2, "0")}`);

export function isValidStudentId(studentId: string): boolean {
  return STUDENTS.includes(studentId);
}
