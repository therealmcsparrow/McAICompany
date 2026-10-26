// Views draw on the terminal and the desktop app; every other surface passes the render through.
export function isViewSurface(surface: string | null | undefined): boolean {
  return surface === 'terminal' || surface === 'desktop'
}
