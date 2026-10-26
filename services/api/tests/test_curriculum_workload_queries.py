from uuid import uuid4
from andromeda_api.application.queries import AcademicDataQueries


class Repository:
    def get_by_id(self, table, identifier):
        return {'external_key':'study_plan:fixture'}
    def evidence_for(self, table, identifier):
        return []
    def manual_reviews_for(self, key):
        return []


def test_semester_metrics_do_not_fall_back_to_whole_course():
    row=dict(id=uuid4(),external_key='item:fixture',study_plan_id=uuid4(),ordinal=1,
             discipline_name='Программа по веб-разработке',semester=3,credits=10,
             hours=360,total_hours=1512,lecture_hours=None,total_lecture_hours=100,
             practice_hours=None,total_practice_hours=200,lab_hours=None,total_lab_hours=300,
             self_study_hours=200,total_self_study_hours=912,assessment_type=None,
             department_name=None,faculty_name=None,chair_name=None,
             source_row={'workload_scope':'optional','source_page':3})
    result=AcademicDataQueries(Repository())._curriculum_item(row)
    assert result.hours==360 and result.total_hours==1512
    assert result.lecture_hours is None and result.self_study_hours==200
    assert result.workload_scope=='optional' and result.source_page==3
    row['discipline_name']='Элективный курс по физической культуре и спорту'
    row['subject_classification']={'category_code':'02'}
    result=AcademicDataQueries(Repository())._curriculum_item(row)
    assert result.general_education_category=='physical_education'
    assert result.subject_classification is None
