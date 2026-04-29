from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str

class UpdatePasswordRequest(BaseModel):
    id: int
    oldpassword: str
    password: str