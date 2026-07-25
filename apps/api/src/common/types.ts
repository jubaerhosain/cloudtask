/** The principal attached to `request.user` by the JWT strategy. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
}
