import { redirect } from 'next/navigation';

// Demo build: no auth — straight to the dashboard. The investigation
// memory + cinematic playback are the artifact under review.
export default function HomePage() {
  redirect('/dashboard');
}
