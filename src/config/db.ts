import mongoose from 'mongoose';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  college: string;
  rollNumber?: string;
  branch: string;
  year: string;
  gender: string;
  linkedin: string;
  portfolio?: string;
  teamPreference?: string;
  tempTeamName?: string;
  tempTeamCode?: string;
  tempSlots?: number;
  registrationType?: 'TEAM' | 'INDIVIDUAL';
  role: 'admin' | 'team-leader' | 'participant';
  paymentStatus: 'pending' | 'submitted' | 'paid' | 'rejected' | 'refunded';
  paymentId?: string;
  utr?: string;
  couponUsed?: string;
  amountPaid: number;
  teamId?: string;
  teamRole?: 'leader' | 'member';
  foodPreference?: 'Veg' | 'Non-Veg';
  tshirtSize?: 'S' | 'M' | 'L' | 'XL' | 'XXL';
  checkedIn: boolean;
  checkInTime?: string;
  profileCompleted?: boolean;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  college: string;
  logoUrl?: string;
  leaderId: string;
  members: string[];
  remainingSlots: number;
  paidSlots?: number;
  status: 'open' | 'full';
  teamStatus?: 'OPEN' | 'CLOSED';
  availableSlots?: number;
  memberCount?: number;
  paymentStatus?: 'pending' | 'paid';
  inviteLink: string;
  qrCodeDataUrl?: string;
  joinRequests: { 
    userId: string; 
    name: string; 
    email: string; 
    college: string; 
    status: 'pending' | 'approved' | 'rejected' | 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
    requestId?: string;
    requestedAt?: string;
    respondedAt?: string;
  }[];
  createdAt: string;
  extraSlotsPending?: number;
  extraSlotsUtr?: string;
  extraSlotsStatus?: 'idle' | 'submitted' | 'approved' | 'rejected';
}

export interface Coupon {
  id: string;
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  collegeName?: string;
  usageLimit: number;
  usageCount: number;
  expiryDate: string;
  isActive: boolean;
  createdAt: string;
}

export interface Notification {
  id: string;
  recipientType: 'all' | 'college' | 'team' | 'individual';
  recipientTarget?: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning';
  readBy: string[];
  createdAt: string;
}

export interface PaymentLog {
  id: string;
  razorpayPaymentId: string;
  razorpayOrderId: string;
  userId: string;
  userName: string;
  userEmail: string;
  amount: number;
  status: 'success' | 'failed' | 'refunded';
  couponUsed?: string;
  createdAt: string;
}

export interface TeamInvite {
  id: string;
  teamId: string;
  teamName: string;
  leaderId: string;
  leaderName: string;
  inviteeEmail: string;
  inviteeId?: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface Guest {
  id: string;
  name: string;
  designation: string;
  topic: string;
  email: string;
  phone: string;
  status: 'invited' | 'confirmed' | 'declined';
  vip: boolean;
  imageUrl?: string;
  createdAt: string;
}

export interface HighlightAlbum {
  id: string;
  title: string;
  description: string;
  coverImageUrl?: string;
  images: string[];
  isPinned: boolean;
  createdAt: string;
}

export interface TimelineEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  description: string;
  category: string;
}

export interface Coordinator {
  id: string;
  name: string;
  role: string;
  dept: string;
  email: string;
  phone: string;
  avatar: string;
  color: string;
}

export interface College {
  id: string;
  name: string;
  createdAt: string;
}

export interface ProblemStatement {
  id: string;
  title: string;
  description: string;
  visibleFrom: string; // ISO Date String
  visibleTo: string;   // ISO Date String
  assignedTo: string[]; // Array of Team IDs (or 'ALL' if it applies to everyone, we can just use a specific string "ALL" or just put all team IDs)
  createdAt: string;
}

export interface VisitorLog {
  id: string;
  ip: string;
  userId?: string;
  userEmail?: string;
  path?: string;
  userAgent?: string;
  visitCount: number;
  firstVisitedAt: string;
  lastVisitedAt: string;
}

// ─── Shared Schema Options ────────────────────────────────────────────────────

const baseOpts = { strict: false };

// ─── Raw Mongoose Models (using Schema.Types.Mixed to avoid deep generics) ───

function makeModel(name: string) {
  if (mongoose.models[name]) return mongoose.models[name];
  const s = new mongoose.Schema({ id: { type: String, required: true, unique: true } }, { ...baseOpts });
  return mongoose.model(name, s);
}

const UserModel       = makeModel('User');
const TeamModel       = makeModel('Team');
const CouponModel     = makeModel('Coupon');
const NotifModel      = makeModel('Notification');
const PaymentModel    = makeModel('Payment');
const InviteModel     = makeModel('Invite');
const GuestModel      = makeModel('Guest');
const HighlightModel  = makeModel('Highlight');
const TimelineModel   = makeModel('Timeline');
const CoordinatorModel = makeModel('Coordinator');
const CollegeModel    = makeModel('College');
const ProblemModel    = makeModel('Problem');
const VisitorModel    = makeModel('Visitor');

// ─── Generic Collection Wrapper ───────────────────────────────────────────────

export class MongoCollection<T extends { id: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private model: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(model: any) {
    this.model = model;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toPlain(doc: any): T {
    if (!doc) return doc;
    const obj = doc.toObject ? doc.toObject({ versionKey: false }) : { ...doc };
    delete obj._id;
    delete obj.__v;
    return obj as T;
  }

  async find(filter?: Partial<T> | ((item: T) => boolean)): Promise<T[]> {
    if (!filter) {
      return (await this.model.find({})).map((d: any) => this.toPlain(d));
    }
    if (typeof filter === 'function') {
      const all: T[] = (await this.model.find({})).map((d: any) => this.toPlain(d));
      return all.filter(filter);
    }
    return (await this.model.find(filter)).map((d: any) => this.toPlain(d));
  }

  async findOne(filter: Partial<T> | ((item: T) => boolean)): Promise<T | null> {
    if (typeof filter === 'function') {
      const all: T[] = (await this.model.find({})).map((d: any) => this.toPlain(d));
      return all.find(filter) || null;
    }
    const doc = await this.model.findOne(filter);
    return doc ? this.toPlain(doc) : null;
  }

  async create(item: Omit<T, 'id'> & { id?: string }): Promise<T> {
    const id = (item as any).id || new mongoose.Types.ObjectId().toHexString();
    const doc = await this.model.create({ ...item, id });
    return this.toPlain(doc);
  }

  async updateOne(id: string, update: Partial<T>): Promise<T | null> {
    const doc = await this.model.findOneAndUpdate({ id }, { $set: update }, { new: true });
    return doc ? this.toPlain(doc) : null;
  }

  async deleteOne(id: string): Promise<boolean> {
    const result = await this.model.deleteOne({ id });
    return (result as any).deletedCount > 0;
  }

  async count(filter?: Partial<T> | ((item: T) => boolean)): Promise<number> {
    return (await this.find(filter)).length;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const Users         = new MongoCollection<User>(UserModel);
export const Teams         = new MongoCollection<Team>(TeamModel);
export const Coupons       = new MongoCollection<Coupon>(CouponModel);
export const Notifications = new MongoCollection<Notification>(NotifModel);
export const Payments      = new MongoCollection<PaymentLog>(PaymentModel);
export const Invites       = new MongoCollection<TeamInvite>(InviteModel);
export const GuestsDb      = new MongoCollection<Guest>(GuestModel);
export const HighlightsDb  = new MongoCollection<HighlightAlbum>(HighlightModel);
export const TimelineDb    = new MongoCollection<TimelineEvent>(TimelineModel);
export const CoordinatorsDb = new MongoCollection<Coordinator>(CoordinatorModel);
export const CollegesDb     = new MongoCollection<College>(CollegeModel);
export const ProblemDb      = new MongoCollection<ProblemStatement>(ProblemModel);
export const VisitorLogs    = new MongoCollection<VisitorLog>(VisitorModel);

// ─── MongoDB Connection ───────────────────────────────────────────────────────

export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set in .env');
  await mongoose.connect(uri);
  console.log('[DB] Connected to MongoDB Atlas successfully.');
}

// ─── Seed Database ────────────────────────────────────────────────────────────

export async function seedDatabase() {
  const adminExists = await Users.findOne({ email: 'admin@codesprint.com' } as any);
  if (!adminExists) {
    await Users.create({
      id: 'wmrq5bwm9',
      name: 'CodeSprint Admin', email: 'admin@codesprint.com', phone: '9999999999',
      college: 'CODESPRINT Core', branch: 'Administration', year: 'N/A', gender: 'Other',
      linkedin: 'https://linkedin.com', role: 'admin', paymentStatus: 'paid',
      amountPaid: 0, checkedIn: false, createdAt: new Date().toISOString()
    });
    console.log('[DB] Admin user seeded.');
  }

  const couponsToSeed = [
    { code: 'JNTUH50', discountType: 'percentage' as const, discountValue: 50, collegeName: 'JNTUH', usageLimit: 50, usageCount: 0, expiryDate: '2026-12-31', isActive: true },
    { code: 'VNR20',   discountType: 'percentage' as const, discountValue: 20, usageLimit: 100, usageCount: 0, expiryDate: '2026-12-31', isActive: true },
    { code: 'MGIT100', discountType: 'percentage' as const, discountValue: 100, collegeName: 'MGIT', usageLimit: 10, usageCount: 0, expiryDate: '2026-12-31', isActive: true }
  ];

  for (const c of couponsToSeed) {
    const exists = await Coupons.findOne({ code: c.code });
    if (!exists) {
      await Coupons.create({ ...c, createdAt: new Date().toISOString() });
    }
  }
  console.log('[DB] Coupons seeding check completed.');

  const coordinatorsToSeed = [
    { id: 'c1', name: 'Dr. N. Penchalaiah', role: 'Faculty Coordinator', dept: 'Dept. of Computer Science & Engineering', email: 'penchalaiah@audisankara.ac.in', phone: '9876500001', avatar: 'NP', color: '#a855f7' },
    { id: 'c2', name: 'Dr. K. Dhanumjaya', role: 'Dean, School of Engineering & Technology', dept: 'School of Engineering & Technology', email: 'dhanumjaya@audisankara.ac.in', phone: '9876500002', avatar: 'KD', color: '#3b82f6' },
    { id: 'c3', name: 'Mr. Arjun Reddy', role: 'Student Coordinator — Lead', dept: 'CSE Final Year', email: 'arjun@codesprint.com', phone: '9000000010', avatar: 'AR', color: '#22c55e' },
    { id: 'c4', name: 'Ms. Sravani Devi', role: 'Student Coordinator — Tech', dept: 'IT Third Year', email: 'sravani@codesprint.com', phone: '9000000011', avatar: 'SD', color: '#f97316' },
    { id: 'c5', name: 'Mr. Karthik Varma', role: 'Student Coordinator — Logistics', dept: 'ECE Final Year', email: 'karthik@codesprint.com', phone: '9000000012', avatar: 'KV', color: '#f59e0b' },
    { id: 'c6', name: 'Ms. Pooja Lakshmi', role: 'Student Coordinator — Design', dept: 'CSE Third Year', email: 'pooja@codesprint.com', phone: '9000000013', avatar: 'PL', color: '#ec4899' },
  ];

  for (const c of coordinatorsToSeed) {
    const exists = await CoordinatorsDb.findOne({ id: c.id });
    if (!exists) {
      await CoordinatorsDb.create(c);
    }
  }

  // Seeding of mock teams and users has been removed to keep the database clean from fake data.
}
