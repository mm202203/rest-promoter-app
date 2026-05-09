SESSION_WARN_SEC_SCORE = 5400  # 90分：状態スコア3 + session_elapsed 超過判定
SESSION_WARN_SEC_LOAD = 2700  # 45分：負荷4〜5 + session_elapsed 超過判定
ACCUM_WARN_SEC = 8100  # 135分：累積バー警告
ACCUM_DANGER_SEC = 10800  # 180分：累積バー上限・force モード判定


def get_advice(state_score: int, load: int, session_elapsed: int) -> dict:
    if state_score <= 2:
        return {
            "level": "danger",
            "message": "状態がかなり悪化しています。休憩を強くおすすめします。",
        }
    if state_score == 3 and session_elapsed > SESSION_WARN_SEC_SCORE:
        return {
            "level": "warn",
            "message": "90分以上連続で作業しています。休憩をおすすめします。",
        }
    if load >= 4 and session_elapsed > SESSION_WARN_SEC_LOAD:
        return {
            "level": "warn",
            "message": "高負荷な作業を45分以上続けています。認知負荷が蓄積しています。",
        }
    return {
        "level": "ok",
        "message": "状態は良好です。このまま続けるか、休憩するか選択してください。",
    }


def get_accum_status(accum_elapsed: int) -> str:
    if accum_elapsed >= ACCUM_DANGER_SEC:
        return "danger"
    if accum_elapsed >= ACCUM_WARN_SEC:
        return "warn"
    return "normal"
