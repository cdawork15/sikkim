import { MediaCredits } from './pages/MediaCredits';
import { DemoProvider } from './features/DemoState';
import { EventDetail } from './features/community/EventDetail';
import { EventForm, EventCreated } from './features/community/EventForm';
import { Chat } from './features/community/Chat';
import { Story } from './features/community/Story';
import './features/features.css';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { EmptyState } from './components/EmptyState';
import { Home } from './pages/Home';
import { HostProfile } from './pages/HostProfile';
import { Explore } from './pages/Explore';
import { Community } from './pages/Community';
import { TravelEssentials } from './pages/TravelEssentials';
import { EssentialsDetail } from './pages/EssentialsDetail';
import { SavedExperiences } from './pages/SavedExperiences';
import { Welcome } from './pages/Welcome';
import { Booking } from './pages/Booking';
import { BookingConfirmation } from './pages/BookingConfirmation';
import { ExperiencePreview } from './pages/ExperiencePreview';

export function DemoApp() {
  return (
    <DemoProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="explore" element={<Explore />} />
          <Route path="hosts" element={<HostProfile />} />
          <Route path="hosts/:category" element={<HostProfile />} />
          <Route path="community" element={<Community />} />
          <Route path="community/create" element={<EventForm />} />
          <Route path="community/events/:id" element={<EventDetail />} />
          <Route path="community/events/:id/edit" element={<EventForm />} />
          <Route
            path="community/events/:id/created"
            element={<EventCreated />}
          />
          <Route path="community/events/:id/chat" element={<Chat />} />
          <Route path="community/stories/:id" element={<Story />} />
          <Route path="credits" element={<MediaCredits />} />
          <Route path="essentials" element={<TravelEssentials />} />
          <Route path="essentials/:section" element={<EssentialsDetail />} />
          <Route path="saved" element={<SavedExperiences />} />
          <Route
            path="my-trip/*"
            element={<Navigate to="/essentials" replace />}
          />
          <Route path="welcome" element={<Welcome />} />
          <Route path="experiences/:id" element={<ExperiencePreview />} />
          <Route path="experiences/:id/book" element={<Booking />} />
          <Route
            path="demo-bookings/:reference"
            element={<BookingConfirmation />}
          />
          <Route
            path="*"
            element={
              <div className="page interior-page">
                <EmptyState
                  title="A little off the beaten path."
                  action="Back to Home"
                  to="/"
                >
                  We couldn’t find that page. There’s plenty more to discover
                  back home.
                </EmptyState>
              </div>
            }
          />
        </Route>
      </Routes>
    </DemoProvider>
  );
}
