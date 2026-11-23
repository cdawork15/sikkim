import type { CommunityEvent } from '../features/community/model';

// Group membership for a Community event. `canChat` is true for the host and
// for members the host has confirmed.
export type MemberStatus =
  'requested' | 'confirmed' | 'waiting' | 'declined' | 'left';
export type GroupMembership = {
  eventId: string;
  role: 'host' | 'member' | null;
  status: MemberStatus | null;
  canChat: boolean;
};
export type MyCommunityItem = {
  event: CommunityEvent;
  role: 'host' | 'member';
  status: MemberStatus;
  canChat: boolean;
};
export type GroupMember = {
  userId: string;
  name: string;
  status: 'requested' | 'confirmed' | 'waiting';
  updatedAt: string;
};
export type ChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  author: string;
  mine: boolean;
  host: boolean;
};
