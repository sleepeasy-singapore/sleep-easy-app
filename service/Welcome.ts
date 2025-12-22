import api from "../api/api";

export type LoginResult = {
  patient: any;
  account: any;
};

type ApiError = Error & { status?: number; body?: any };

const buildApiError = ({
  status,
  body,
  fallback,
}: {
  status?: number;
  body?: any;
  fallback: string;
}): ApiError => {
  const message = body?.msg || body?.message || fallback;
  const err = new Error(message) as ApiError;
  const numericStatus = Number(status);
  if (Number.isFinite(numericStatus)) err.status = numericStatus;
  if (body !== undefined) err.body = body;
  return err;
};

export const loginWithEmailAndPassword = async (params: {
  email: string;
  password: string;
}): Promise<LoginResult> => {
  const { email, password } = params;

  if (!email?.trim()) throw new Error("Missing email.");
  if (!password) throw new Error("Missing password.");

  let res;
  try {
    res = await api.get(`sleep_easy_app/login_with_email_and_password.php`, {
      params: { email, password },
    });
  } catch (error: any) {
    const status =
      error?.response?.data?.status ??
      error?.response?.status ??
      error?.status;
    const body = error?.response?.data;
    throw buildApiError({
      status,
      body,
      fallback: error?.message || "Login failed.",
    });
  }

  const body = res?.data ?? {};
  const status = Number(body?.status ?? res.status);

  if (res.status >= 200 && res.status < 300 && status === 200) {
    return {
      patient: body?.patient ?? body?.data?.patient,
      account: body?.account ?? body?.data?.account,
    };
  }

  throw buildApiError({
    status,
    body,
    fallback: "Login failed.",
  });
};

export const validateLoginDetails = loginWithEmailAndPassword;

export type CreateAccountResult = {
  account_id: number;
  patient_id: number;
};

export const createAccountWithEmailAndPassword = async (params: {
  email: string;
  password: string;
}): Promise<CreateAccountResult> => {
  const { email, password } = params;

  if (!email?.trim()) throw new Error("Missing email.");
  if (!password) throw new Error("Missing password.");

  const payload = new FormData();
  payload.append("email", email.trim());
  payload.append("password", password);

  let res;
  try {
    res = await api.post(
      `sleep_easy_app/create_account_with_email.php`,
      payload,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
  } catch (error: any) {
    const status =
      error?.response?.data?.status ??
      error?.response?.status ??
      error?.status;
    const body = error?.response?.data;
    throw buildApiError({
      status,
      body,
      fallback: error?.message || "Create account failed.",
    });
  }

  const body = res?.data ?? {};
  const status = Number(body?.status ?? res.status);

  if (res.status >= 200 && res.status < 300 && status === 200) {
    return {
      account_id: Number(body?.account_id ?? body?.data?.account_id),
      patient_id: Number(body?.patient_id ?? body?.data?.patient_id),
    };
  }

  throw buildApiError({
    status,
    body,
    fallback: "Create account failed.",
  });
};
