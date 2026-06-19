import { ClockIcon, LogOut } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function PendingApprovalPage({ rejected = false }: { rejected?: boolean }) {
  const { user, signOut } = useAuth()

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="max-w-md w-full mx-4 text-center">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 ${
            rejected ? 'bg-red-100' : 'bg-amber-100'
          }`}>
            <ClockIcon className={`w-8 h-8 ${rejected ? 'text-red-500' : 'text-amber-500'}`} />
          </div>

          {rejected ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900 mb-2">Access not approved</h1>
              <p className="text-gray-500 text-sm leading-relaxed">
                Your account request for <span className="font-medium text-gray-700">{user?.email}</span> was
                not approved. Please contact your administrator for more information.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-gray-900 mb-2">Awaiting approval</h1>
              <p className="text-gray-500 text-sm leading-relaxed">
                Your account <span className="font-medium text-gray-700">{user?.email}</span> has been
                created and is pending approval by an administrator. You will be able to log in once
                your account is approved.
              </p>
            </>
          )}

          <button
            onClick={signOut}
            className="mt-8 flex items-center gap-2 mx-auto text-sm text-gray-500 hover:text-gray-700"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
