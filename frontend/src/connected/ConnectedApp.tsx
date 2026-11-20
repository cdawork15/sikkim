import { SharedCommunity } from './Community';
import { BookingFlow } from './BookingFlow';
import { BookingDetails, MyBookings } from './Bookings';
import { HostDates, HostBookingDate } from './BookingHosts';
import './bookings.css';
import { ConnectedMediaCredits } from './MediaCredits';
import { Reels, Saved, CommunityStories, HostStory } from './Media';
import {
  MediaWorkspace,
  ExperienceMediaEditor,
  StoryWorkspace,
} from './MediaWorkspace';
import './media.css';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ApiProvider, useApi, useSession } from '../api/react';
import { AppShell } from '../components/AppShell';
import { isReelsLocation } from '../lib/explore';
import { Account, SettingsPage, Welcome } from './Account';
import { Detail, Explore, HostDetail, Hosts } from './Catalogue';
import { ExperienceEditor, ExperienceWorkspace, Hosting } from './Hosting';
import { ReviewDetail, ReviewQueue } from './Review';
import { AdminUserPage, AdminWorkspace, LeadPage } from './Admin';
import { ShareReel } from './ShareReel';
import { Onboarding } from './OtpSignIn';
import { Home } from './Home';
import { Empty, RequireAccount } from './shared';
import { DEMO_KEY, DemoProvider } from '../features/DemoState';
import { Community } from '../pages/Community';
import { TravelEssentials } from '../pages/TravelEssentials';
import { EssentialsDetail } from '../pages/EssentialsDetail';
import { EventDetail } from '../features/community/EventDetail';
import { EventForm, EventCreated } from '../features/community/EventForm';
import { Chat } from '../features/community/Chat';
import { Story } from '../features/community/Story';
import '../features/features.css';
import './connected.css';

function Shell() {
  const api = useApi();
  const session = useSession();
  return (
    <AppShell
      account={session.user}
      sessionNotice={session.notice}
      onSignOut={() => api.logout()}
      connected
    />
  );
}
function Workspace({ children }: { children: import('react').ReactNode }) {
  return <div className="api-shell">{children}</div>;
}
function ComingSoon({ title }: { title: string }) {
  return (
    <div className="page interior-page availability-page">
      <Empty>
        <h1>{title}</h1>
        <p>
          This part of the app is not connected yet. Browse experiences while we
          get it ready.
        </p>
        <Link className="button button-primary" to="/explore">
          Explore experiences
        </Link>
      </Empty>
    </div>
  );
}
function ExploreEntry() {
  const { pathname, search } = useLocation();
  return isReelsLocation(pathname, search) ? (
    <Reels />
  ) : (
    <Workspace>
      <Explore />
    </Workspace>
  );
}
function CommunityPreview({
  children,
}: {
  children: import('react').ReactNode;
}) {
  const { user } = useSession();
  const identity = user?.id ?? 'guest';
  return (
    <DemoProvider
      key={identity}
      storageKey={`${DEMO_KEY}:account:${identity}`}
      readOnly={!user}
    >
      <SharedCommunity>{children}</SharedCommunity>
    </DemoProvider>
  );
}
function CommunityAccount({
  children,
}: {
  children: import('react').ReactNode;
}) {
  return (
    <Workspace>
      <RequireAccount>{children}</RequireAccount>
    </Workspace>
  );
}
export function ConnectedApp() {
  return (
    <ApiProvider>
      <CommunityPreview>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Home />} />
            <Route path="explore" element={<ExploreEntry />} />
            <Route
              path="experiences/:slug"
              element={
                <Workspace>
                  <Detail />
                </Workspace>
              }
            />
            <Route
              path="hosts"
              element={
                <Workspace>
                  <Hosts />
                </Workspace>
              }
            />
            <Route
              path="hosts/:id"
              element={
                <Workspace>
                  <HostDetail />
                </Workspace>
              }
            />
            <Route
              path="welcome"
              element={
                <Workspace>
                  <Welcome />
                </Workspace>
              }
            />
            <Route
              path="account"
              element={
                <Workspace>
                  <Account />
                </Workspace>
              }
            />
            <Route
              path="settings"
              element={
                <Workspace>
                  <SettingsPage />
                </Workspace>
              }
            />
            <Route
              path="hosting"
              element={
                <Workspace>
                  <Hosting />
                </Workspace>
              }
            />
            <Route
              path="hosting/experiences"
              element={
                <Workspace>
                  <ExperienceWorkspace />
                </Workspace>
              }
            />
            <Route
              path="hosting/experiences/new"
              element={
                <Workspace>
                  <ExperienceEditor />
                </Workspace>
              }
            />
            <Route
              path="hosting/experiences/:id"
              element={
                <Workspace>
                  <ExperienceEditor />
                </Workspace>
              }
            />
            <Route path="onboarding" element={<Onboarding />} />
            <Route path="reels/new" element={<ShareReel />} />
            <Route path="admin" element={<AdminWorkspace />} />
            <Route path="admin/leads/new" element={<LeadPage />} />
            <Route path="admin/leads/:id" element={<LeadPage />} />
            <Route path="admin/users/:id" element={<AdminUserPage />} />
            <Route
              path="review"
              element={
                <Workspace>
                  <ReviewQueue />
                </Workspace>
              }
            />
            <Route
              path="review/hosts/:id"
              element={
                <Workspace>
                  <ReviewDetail kind="hosts" />
                </Workspace>
              }
            />
            <Route
              path="review/experiences/:id"
              element={
                <Workspace>
                  <ReviewDetail kind="experiences" />
                </Workspace>
              }
            />
            <Route path="explore/reels" element={<Reels />} />
            <Route path="saved" element={<Saved />} />
            <Route
              path="hosting/media"
              element={
                <Workspace>
                  <MediaWorkspace />
                </Workspace>
              }
            />
            <Route
              path="hosting/stories"
              element={
                <Workspace>
                  <StoryWorkspace />
                </Workspace>
              }
            />
            <Route
              path="hosting/experiences/:id/media"
              element={
                <Workspace>
                  <ExperienceMediaEditor />
                </Workspace>
              }
            />
            <Route
              path="review/media"
              element={
                <Workspace>
                  <MediaWorkspace admin />
                </Workspace>
              }
            />
            <Route path="community/host-stories/:id" element={<HostStory />} />
            <Route
              path="community"
              element={<Community stories={<CommunityStories />} />}
            />
            <Route
              path="community/create"
              element={
                <CommunityAccount>
                  <EventForm />
                </CommunityAccount>
              }
            />
            <Route path="community/events/:id" element={<EventDetail />} />
            <Route
              path="community/events/:id/edit"
              element={
                <CommunityAccount>
                  <EventForm />
                </CommunityAccount>
              }
            />
            <Route
              path="community/events/:id/created"
              element={
                <CommunityAccount>
                  <EventCreated />
                </CommunityAccount>
              }
            />
            <Route
              path="community/events/:id/chat"
              element={
                <CommunityAccount>
                  <Chat />
                </CommunityAccount>
              }
            />
            <Route path="community/stories/:id" element={<Story />} />
            <Route path="credits" element={<ConnectedMediaCredits />} />
            <Route path="essentials" element={<TravelEssentials />} />
            <Route
              path="essentials/bookings"
              element={
                <Workspace>
                  <MyBookings />
                </Workspace>
              }
            />
            <Route
              path="essentials/bookings/:id"
              element={
                <Workspace>
                  <BookingDetails />
                </Workspace>
              }
            />
            <Route
              path="hosting/experiences/:id/dates"
              element={
                <Workspace>
                  <HostDates />
                </Workspace>
              }
            />
            <Route
              path="hosting/slots/:id"
              element={
                <Workspace>
                  <HostBookingDate />
                </Workspace>
              }
            />
            <Route
              path="essentials/:section"
              element={<EssentialsDetail connected />}
            />
            <Route
              path="my-trip/*"
              element={<Navigate to="/essentials" replace />}
            />
            <Route
              path="experiences/:slug/book"
              element={
                <Workspace>
                  <BookingFlow />
                </Workspace>
              }
            />
            <Route
              path="*"
              element={<ComingSoon title="We couldn’t find that page." />}
            />
          </Route>
        </Routes>
      </CommunityPreview>
    </ApiProvider>
  );
}
