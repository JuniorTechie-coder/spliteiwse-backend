// Payload sent by frontend during registration
//Registration Interface
export interface RegisterRequestBody {
  username: string;        // We will map this to database column 'username'
  email: string;
  password: string;
}

//Login Interface
export interface LoginRequestBody {
  email: string,
  password: string;
}



