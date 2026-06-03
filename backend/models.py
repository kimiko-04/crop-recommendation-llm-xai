from pydantic import BaseModel, EmailStr


class UserCreate(BaseModel):
    username: str
    email:    EmailStr
    password: str


class UserLogin(BaseModel):
    email:    EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type:   str


class PredictRequest(BaseModel):
    n:           float
    p:           float
    k:           float
    temperature: float
    humidity:    float
    ph:          float
    rainfall:    float
