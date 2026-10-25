import server

class FakeFight:
    kill_log = []

def test_final_adds_round_points_dogfight_and_agenda():
    r = server.Room(code="P"); r.question_mode = "arcade"
    a = server.Player(pid="a", joined=True, name="A", agenda="featherweight", score=600)
    b = server.Player(pid="b", joined=True, name="B", agenda="duelist", score=200)
    for p in (a, b): p.loadout = server.partsmod.Loadout()
    r.players = {"a": a, "b": b}
    rows = [{"pid": "a", "score": 100}, {"pid": "b", "score": 300}]
    out = server.score_agendas(r, FakeFight(), rows)
    by = {x["pid"]: x for x in out}
    # A: 600 arcade + 100 dogfight + 200 featherweight (bare jet) = 900
    assert by["a"]["final"] == 900 and by["a"]["matchPoints"] == 600 and by["a"]["fightScore"] == 100
    # B: 200 + 300 + 0 (never caught a rival) = 500
    assert by["b"]["final"] == 500
    assert [x["pid"] for x in out] == ["a", "b"], "sorted for the podium"
    assert by["a"]["mode"] == "arcade"
