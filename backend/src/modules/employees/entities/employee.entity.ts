export interface Employee {
  id: string;
  hcmEmployeeId: string;
  name: string;
  email: string;
  managerId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
