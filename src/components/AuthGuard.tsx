import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { auth } from '../firebase/auth';

type AuthGuardProps = {
  children: ReactNode;
};

export default function AuthGuard({ children }: AuthGuardProps) {
  const user = auth.currentUser;

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
