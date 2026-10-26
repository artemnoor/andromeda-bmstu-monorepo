"""Regression against the public PDF that exposed repeated course totals."""
from pathlib import Path
import shutil
import pytest
from andromeda.ingestion.universities.bmstu.parser.campaign_2026.curricula.parser import parse_curriculum_document


@pytest.mark.skipif(shutil.which('pdftotext') is None, reason='Poppler is required for PDF extraction')
def test_academic_core_reconciles_and_vk_modules_stay_optional():
    body=(Path(__file__).parent/'fixtures/bmstu/ingestion/curriculum-010302-01.pdf').read_bytes()
    parsed=parse_curriculum_document(body,content_type='application/pdf',final_url='https://disk.yandex.ru/d/f-X955NpK4DpTw',share_url='https://clck.ru/3UDeyQ',profile={'code':'01.03.02-01','study_plan_external_key':'study_plan:regression'},retrieved_at='2026-10-26T00:00:00+00:00')
    core=[item for item in parsed['items'] if item['source_row']['workload_scope']=='core']
    assert sum(item['hours'] or 0 for item in core)==12960
    assert sum(item['credits'] or 0 for item in core)==360
    assert sum(item['hours'] or 0 for item in core if item['semester']==3)==1044
    assert [row['hours'] for row in parsed['semester_totals']]==[1116,1044,1044,1116,1116,1188,900,1080,1080,1116,1080,1080]
    vk=[item for item in parsed['items'] if item['discipline']=='Программа по веб-разработке (модуль 1 от VK)']
    assert [(row['semester'],row['hours'],row['credits']) for row in vk]==[(3,360,10),(4,756,21),(5,396,11)]
    assert all(row['source_row']['workload_scope']=='optional' for row in vk)
    pe=next(item for item in parsed['items'] if item['discipline'].startswith('Элективный курс по физической'))
    assert pe['source_row']['workload_scope']=='non_credit'
    assert pe['semester'] is None and pe['hours']==340


@pytest.mark.skipif(shutil.which('pdftotext') is None, reason='Poppler is required for PDF extraction')
@pytest.mark.parametrize('filename,code,semesters,hours,credits', [
    ('curriculum-020301-01.pdf','02.03.01-01',8,8640,240),
    ('curriculum-090301-53-adaptive.pdf','09.03.01-53',14,12960,360),
])
def test_four_and_seven_year_templates_reconcile_every_semester(filename,code,semesters,hours,credits):
    body=(Path(__file__).parent/'fixtures/bmstu/ingestion'/filename).read_bytes()
    parsed=parse_curriculum_document(body,content_type='application/pdf',final_url='https://disk.yandex.ru/i/fixture',share_url='https://disk.yandex.ru/i/fixture',profile={'code':code,'study_plan_external_key':'study_plan:regression'},retrieved_at='2026-10-26T00:00:00+00:00')
    core=[item for item in parsed['items'] if item['source_row']['workload_scope']=='core']
    assert parsed['semester_count']==semesters
    assert sum(item['hours'] or 0 for item in core)==hours
    assert sum(item['credits'] or 0 for item in core)==credits
    assert all(item['semester'] is not None for item in core)
    for total in parsed['semester_totals']:
        assert total['hours']==sum(item['hours'] or 0 for item in core if item['semester']==total['semester'])
        assert total['credits']==sum(item['credits'] or 0 for item in core if item['semester']==total['semester'])
