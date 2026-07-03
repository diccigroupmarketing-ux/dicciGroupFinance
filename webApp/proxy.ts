// Gate auth Clerk: SEMUA laluan dilindungi kecuali sign-in dan /api/pyIngest
// (function Python ada guard UPLOAD_TOKEN sendiri; dipanggil server-to-server
// dari /api/upload tanpa cookie session, jadi WAJIB kekal luar gate Clerk).
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublic = createRouteMatcher(["/sign-in(.*)", "/api/pyIngest(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Langkau internals Next dan fail statik
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Sentiasa jalan untuk API
    "/(api|trpc)(.*)",
  ],
};
