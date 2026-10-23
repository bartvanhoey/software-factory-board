using System;
using System.Threading.Tasks;
using EmployeeManagement.API.Models;
using EmployeeManagement.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace EmployeeManagement.Api.Controllers { 

    [Route("api/[Controller]")]
    [ApiController]
    public class DepartmentsController : ControllerBase{
        private readonly IDepartmentRepository _departmentRepository;

        public DepartmentsController(IDepartmentRepository departmentRepository)
        {
            _departmentRepository = departmentRepository;
        }

        [HttpGet]
        public async Task<ActionResult> GetDepartments(){
                try
                {
                    return Ok(await _departmentRepository.GetDepartments());
                }
                catch (Exception)
                {
                 return StatusCode(StatusCodes.Status500InternalServerError, "Error retrieving data from the database"); 
                }
        }

        [HttpGet("{id:int}")]
        public async Task<ActionResult<Department>> GetDepartment(int id){
                try
                {
                   var result = await _departmentRepository.GetDepartment(id);
                   if (result == null)
                   {
                       return NotFound();
                   }
                   return result;
                }
                catch (Exception)
                {
                 return StatusCode(StatusCodes.Status500InternalServerError, "Error retrieving data from the database"); 
                }
        }
    }
}