// Payload sent by frontend during registration
// Registration Interface
export interface RegisterRequestBody {
  username: string; // Database column 'username'
  email: string;
  password: string;
}

// Login Interface
export interface LoginRequestBody {
  email: string;
  password: string;
}

