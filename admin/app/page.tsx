import { redirect } from 'next/navigation'

// Home, not the menu. The first screen has to say "things are working"; a list of
// dishes says "here is work to do".
export default function RootPage() {
  redirect('/home')
}
