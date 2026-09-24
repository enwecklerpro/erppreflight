from src.engines.software_collection import SoftwareCollectionEngine
from src.engines.transport_dependency import TransportDependencyEngine

def test_dag_topo():
    # Complex DAG:
    # 1 -> 2, 1 -> 3
    # 2 -> 4, 3 -> 4
    # 4 -> 5, 4 -> 6
    # 5 -> 7, 6 -> 7
    # 8 -> 9 (disjoint component)
    # 10 (isolated node)
    cols = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9', 'N10']
    deps = {
        'N1': [],
        'N2': ['N1'],
        'N3': ['N1'],
        'N4': ['N2', 'N3'],
        'N5': ['N4'],
        'N6': ['N4'],
        'N7': ['N5', 'N6'],
        'N8': [],
        'N9': ['N8'],
        'N10': [],
    }
    res = SoftwareCollectionEngine.evaluate(cols, deps)
    seq = res['recommended_sequence']
    print('SC Topo Seq:', seq)
    assert len(seq) == 10
    # Verify that every dependency comes before dependent
    for node, prereqs in deps.items():
        for p in prereqs:
            assert seq.index(p) < seq.index(node), f'{p} not before {node}'
    print('All topological constraints satisfied in SoftwareCollection!')

    # Now test TransportDependency Kahn algorithm
    trs = {f'TR_{i}': [f'CLAS ZCL_{i}'] for i in range(1, 11)}
    calls = []
    for node, prereqs in deps.items():
        for p in prereqs:
            caller = f'TR_{node[1:]}'
            callee = f'TR_{p[1:]}'
            calls.append({'caller_tr': caller, 'callee_tr': callee, 'caller_object': f'CLAS ZCL_{node[1:]}', 'callee_object': f'CLAS ZCL_{p[1:]}'})

    res_tr = TransportDependencyEngine.evaluate(trs, call_references=calls)
    tr_seq = res_tr['recommended_import_sequence']
    print('TR Topo Seq:', tr_seq)
    assert len(tr_seq) == 10
    for call in calls:
        assert tr_seq.index(call['callee_tr']) < tr_seq.index(call['caller_tr']), f"{call['callee_tr']} not before {call['caller_tr']}"
    print('All topological constraints satisfied in TransportDependency!')

if __name__ == '__main__':
    test_dag_topo()
