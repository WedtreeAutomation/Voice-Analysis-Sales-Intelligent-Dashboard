export type ActiveView =
  | 'home'
  | 'call-history'
  | 'agents'
  | 'analytics'
  | 'settings';

export interface FirestoreTimestamp {
  seconds: number;
  nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
}

export interface User {
  uid: string;
  email: string;
  name: string;
  role: 'manager' | 'agent';
  profilePic?: string;
  phone?: string;
  createdAt?: FirestoreTimestamp;  // optional
  updatedAt?: FirestoreTimestamp;  // optional
}
