import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

// Coarse gate only — every action and route handler re-checks permissions on the server.
const isProtected = createRouteMatcher(["/admin(.*)", "/api/exports(.*)"]);

const clerk = clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export default function middleware(req: NextRequest, ev: NextFetchEvent) {
  // The dev-only design preview works without Clerk keys.
  if (process.env.NODE_ENV !== "production" && req.nextUrl.pathname === "/preview") return NextResponse.next();
  return clerk(req, ev);
}

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
