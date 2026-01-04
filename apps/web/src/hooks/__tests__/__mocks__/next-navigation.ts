// Mock for next/navigation
export const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  forward: jest.fn(),
  refresh: jest.fn(),
  prefetch: jest.fn(),
}

let currentPathname = '/dashboard'

export const mockPathname = jest.fn(() => currentPathname)

export const setMockPathname = (pathname: string) => {
  currentPathname = pathname
  mockPathname.mockReturnValue(pathname)
}

export const mockSearchParams = new URLSearchParams()

// Reset helper for tests
export const resetNavigationMocks = () => {
  Object.values(mockRouter).forEach((fn) => fn.mockReset())
  currentPathname = '/dashboard'
  mockPathname.mockReset().mockReturnValue('/dashboard')
}

// The actual mock module
const navigationMock = {
  useRouter: () => mockRouter,
  usePathname: () => mockPathname(),
  useSearchParams: () => mockSearchParams,
}

export default navigationMock
